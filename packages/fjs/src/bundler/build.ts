// fjs build — esbuild bundling + optional bytecode compilation via fjsc.
//
// Build shapes:
//   default           one self-contained bundle (runtime + app + pages)
//   --pages           split build: shared.js (prelude: vue + fjs + the app
//                     shell) + bundle.js (app entry) + pages/<id>.js, one
//                     chunk per route, so a page never re-ships the runtime
//   --web             browser build: DOM tag adapter + vue-router, one
//                     esbuild chunk per page, plus an index.html
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import esbuild from 'esbuild';
import { ensureFlutterHost, projectName } from '../commands/run.js';
import {
  vueSfcPlugin,
  flutterAliases,
  webAliases,
  vuePinPlugin,
  webPinPlugin,
  pagesPlugin,
  pluginsPlugin,
  sharedBare,
  SHARED_BARE_BUILTIN,
  sharedStubPlugin,
  srcAliasPlugin,
} from './vue-plugin.js';
import { pageChunkSource, pagesFor, writeRouteTypes, type PageRoute } from '../project/pages.js';
import { pluginsFor } from '../project/plugins.js';
import { printAnalysis } from './analyze.js';
import { flutterDir as configuredFlutterDir } from '../project/config.js';
import type { Metafile } from 'esbuild';

export type FlutterMode = 'debug' | 'profile' | 'release';

/** `--<mode>` for a `flutter build`/`flutter run`, unless the caller
 * already passed one after `--`. Flutter refuses more than one build-mode
 * flag, so injecting ours unconditionally would break the documented
 * `npm run build:apk -- --debug` passthrough. */
export function flutterModeArgs(mode: FlutterMode, flutterArgs: string[]): string[] {
  const explicit = ['--debug', '--profile', '--release', '--jit-release'];
  return flutterArgs.some((arg) => explicit.includes(arg)) ? [] : [`--${mode}`];
}

export interface BuildOptions {
  entry?: string;
  outDir: string;
  /** Minify the bundles. Default true for `fjs build`; `fjs dev` turns it
   * off so the served bundle stays readable in a stack trace. */
  minify: boolean;
  bytecode: boolean;
  /** '--pages': shared prelude + app entry + one chunk per route. */
  pages: boolean;
  /** '--web': browser build (DOM adapter + vue-router). */
  web: boolean;
  /** Production build: bytecode + copy split assets into Flutter. */
  release: boolean;
  /** Build mode handed to `flutter build`. --profile bakes the same
   * release assets as --release and only changes this. */
  mode: FlutterMode;
  /** With --release, gzip .fjsbundle assets copied into Flutter. */
  gz: boolean;
  /** With --release, also run `flutter build apk`. */
  apk: boolean;
  /** Flutter host project dir used by --release/--apk. */
  flutterDir: string;
  /** Extra args passed to `flutter build apk` after `--`. */
  flutterArgs: string[];
  /** '--analyze': keep esbuild's metafile and print a size report. */
  analyze?: boolean;
}

/** An entry esbuild reads straight from memory.
 *
 * The shared chunk and every page chunk are built from a few generated
 * lines. Writing those into outDir as `.<name>-entry.ts` files made two
 * concurrent builds — a second `fjs dev` on the same project, or several
 * dev requests at once — delete each other's entry mid-build
 * (`Could not resolve ".../.<name>-entry.ts"`). Feeding the source in
 * directly also keeps a chunk byte-identical between builds, which is what
 * lets `fjs dev` tell which chunks an edit really changed.
 *
 * [name] only names the module in the bundle's comments, so it must stay
 * stable across builds.
 */
function generatedEntry(
  contents: string,
  resolveDir: string,
  name: string,
): esbuild.StdinOptions {
  return { contents, resolveDir, sourcefile: `fjs-entry/${name}.ts`, loader: 'ts' };
}

export function parseBuildArgs(argv: string[]): BuildOptions {
  const opts: BuildOptions = {
    outDir: 'dist',
    // on by default, like `vite build`; `fjs dev` passes minify: false
    minify: true,
    bytecode: false,
    pages: false,
    web: false,
    release: false,
    mode: 'release',
    gz: false,
    apk: false,
    flutterDir: configuredFlutterDir(),
    flutterArgs: [],
    analyze: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      opts.flutterArgs = argv.slice(i + 1);
      break;
    }
    if (a === '--bytecode') opts.bytecode = true;
    else if (a === '--release') opts.release = true;
    else if (a === '--profile') {
      // same assets as --release; only the Flutter step differs
      opts.release = true;
      opts.mode = 'profile';
    }
    else if (a === '--apk') opts.apk = true;
    else if (a === '--minify') opts.minify = true;
    else if (a === '--no-minify') opts.minify = false;
    else if (a === '--gz') opts.gz = true;
    else if (a === '--out') opts.outDir = argv[++i] ?? opts.outDir;
    else if (a === '--flutter-dir') opts.flutterDir = argv[++i] ?? opts.flutterDir;
    else if (a === '--analyze') opts.analyze = true;
    else if (a === '--pages') opts.pages = true;
    else if (a === '--web') opts.web = true;
    else if (a === '--shared-runtime' || a === '--shared') {
      throw new Error(`${a} was removed; use --pages --release for app release builds`);
    }
    else if (!a.startsWith('-')) opts.entry = a;
  }
  return opts;
}

const VUE_DEFINES = {
  'process.env.NODE_ENV': '"production"',
  __VUE_OPTIONS_API__: 'true',
  __VUE_PROD_DEVTOOLS__: 'false',
  __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
};

export interface BuildResult {
  jsPath: string;
  bytecodePath?: string;
  /** Split builds: the shared prelude and the per-page chunks. */
  sharedPath?: string;
  sharedBytecodePath?: string;
  pageChunks?: Record<string, string>;
  pageBytecodeChunks?: Record<string, string>;
  /** '--analyze' only: esbuild metafiles keyed by the js file they built. */
  metafiles?: Record<string, Metafile>;
  warnings: string[];
}

export async function buildBundle(opts: BuildOptions): Promise<BuildResult> {
  const outDir = path.resolve(opts.outDir);
  fs.mkdirSync(outDir, { recursive: true });
  // route names as types, before anything reads them
  writeRouteTypes(process.cwd());

  const exclusive = [opts.pages, opts.web].filter(Boolean);
  if (exclusive.length > 1) {
    throw new Error('--web and --pages are mutually exclusive');
  }
  if (opts.web) return buildWeb(opts, outDir);
  if (opts.pages) return buildPages(opts, outDir);

  const baseName = 'bundle';
  const jsPath = path.join(outDir, `${baseName}.js`);
  const root = process.cwd();

  const entry = path.resolve(opts.entry ?? 'src/main.ts');
  // single bundle: every page is imported straight into it
  const plugins = [
    pagesPlugin(pagesFor(root, 'app'), 'app', true),
    pluginsPlugin(pluginsFor(root, 'app')),
    vueSfcPlugin(),
    vuePinPlugin(),
    srcAliasPlugin(root),
  ];
  const alias = flutterAliases();
  if (!fs.existsSync(entry)) {
    throw new Error(`entry not found: ${entry}`);
  }

  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    outfile: jsPath,
    format: 'iife',
    target: 'es2021',
    platform: 'neutral',
    minify: opts.minify,
    alias,
    plugins,
    define: VUE_DEFINES,
    metafile: opts.analyze,
    logLevel: 'warning',
    legalComments: 'none',
  });
  const warnings = result.warnings.map((w) => w.text);

  const res: BuildResult = { jsPath, warnings };
  if (result.metafile) res.metafiles = { [jsPath]: result.metafile };
  if (opts.bytecode) {
    res.bytecodePath = compileBytecode(jsPath, outDir, baseName);
  }
  return res;
}

// ---- split build (--pages) -------------------------------------------------

/** Source of the shared-chunk entry. [appModules] are the project's own
 * modules that the app entry pulls in (shell, components, stores): putting
 * them in the shared chunk is what keeps a page chunk down to the page. */
function sharedEntrySource(
  appModules: Map<string, string> = new Map(),
  extraShared: string[] = [],
): string {
  const lines = [
    "import * as vue from 'vue';",
    "import * as fjs from 'fjs';",
    "import * as fjsVue from 'fjs/vue';",
    "import * as fjsRouter from 'fjs/router';",
    "import * as fjsApp from 'fjs/app';",
    "import * as fjsPages from 'fjs/pages';",
    "import * as fjsPlugins from 'fjs/plugins';",
    "import * as runtimeCore from '@vue/runtime-core';",
    "import * as reactivity from '@vue/reactivity';",
    "import * as shared from '@vue/shared';",
  ];
  const registrations = [
    "  vue, fjs, 'fjs/vue': fjsVue, 'fjs/router': fjsRouter,",
    "  'fjs/app': fjsApp, 'fjs/pages': fjsPages, 'fjs/plugins': fjsPlugins,",
    "  '@vue/runtime-core': runtimeCore, '@vue/reactivity': reactivity,",
    "  '@vue/shared': shared,",
  ];
  // `fjs.shared` from package.json: third-party packages that page chunks
  // import directly and that must stay a single module instance.
  const extra: string[] = [];
  extraShared.forEach((id, n) => {
    lines.push(`import * as __s${n} from ${JSON.stringify(id)};`);
    extra.push(
      `S[${JSON.stringify(id)}] = Object.assign({ __esModule: true }, __s${n});`,
    );
  });
  let i = 0;
  for (const [key, abs] of appModules) {
    lines.push(`import * as __m${i} from ${JSON.stringify(abs)};`);
    // __esModule marks the namespace copy as ESM so a `import X from` in a
    // page chunk gets X, not { default: X }
    extra.push(
      `S[${JSON.stringify(key)}] = Object.assign({ __esModule: true }, __m${i});`,
    );
    i++;
  }
  return `${lines.join('\n')}\nconst S = {\n${registrations.join(
    '\n',
  )}\n};\n${extra.join('\n')}\n(globalThis).__FJS_SHARED = S;\n`;
}

/** Decides which of the app's own modules belong in the shared chunk.
 *
 * A module goes in when the app entry pulls it in (the shell, its
 * components, stores) or when two or more pages import it (Panel.vue in
 * hello-fjs) — those are exactly the modules that would otherwise be
 * duplicated into every page chunk. Page files themselves never go in:
 * they *are* the chunks.
 *
 * One probe build with every entry point at once gives esbuild's metafile
 * an inputs list per output, which is all this needs.
 */
async function appModuleGraph(
  entry: string,
  root: string,
  pages: PageRoute[],
): Promise<Map<string, string>> {
  const pageFiles = new Set(pages.map((p) => p.file));
  const probe = await esbuild.build({
    entryPoints: [entry, ...pages.map((p) => p.file)],
    bundle: true,
    write: false,
    metafile: true,
    outdir: path.join(root, '.fjs-probe'),
    format: 'iife',
    target: 'es2021',
    platform: 'neutral',
    alias: flutterAliases(),
    plugins: [
      pagesPlugin(pages, 'app', false),
      pluginsPlugin(pluginsFor(root, 'app')),
      vueSfcPlugin(),
      vuePinPlugin(),
      srcAliasPlugin(root),
    ],
    define: VUE_DEFINES,
    logLevel: 'silent',
  });

  const isAppModule = (input: string): string | null => {
    // esbuild reports virtual modules as "<namespace>:<path>" — the
    // generated route table and the shared stubs, not app files
    if (input.includes(':')) return null;
    const abs = path.resolve(input);
    if (!abs.startsWith(root + path.sep)) return null;
    if (abs.includes(`${path.sep}node_modules${path.sep}`)) return null;
    if (abs === entry || pageFiles.has(abs)) return null;
    return fs.existsSync(abs) ? abs : null;
  };

  const shared = new Set<string>();
  const pageUse = new Map<string, number>();
  for (const output of Object.values(probe.metafile.outputs)) {
    const fromEntry = output.entryPoint && path.resolve(output.entryPoint) === entry;
    for (const input of Object.keys(output.inputs)) {
      const abs = isAppModule(input);
      if (!abs) continue;
      if (fromEntry) shared.add(abs);
      else pageUse.set(abs, (pageUse.get(abs) ?? 0) + 1);
    }
  }
  for (const [abs, uses] of pageUse) {
    if (uses > 1) shared.add(abs);
  }

  const modules = new Map<string, string>();
  for (const abs of [...shared].sort()) {
    modules.set('./' + path.relative(root, abs).replace(/\\/g, '/'), abs);
  }
  return modules;
}

async function buildPages(opts: BuildOptions, outDir: string): Promise<BuildResult> {
  const root = process.cwd();
  const entry = path.resolve(opts.entry ?? 'src/main.ts');
  if (!fs.existsSync(entry)) throw new Error(`entry not found: ${entry}`);
  const pages = pagesFor(root, 'app');
  const warnings: string[] = [];

  // 1) which of the app's modules belong in the shared chunk
  const appModules = await appModuleGraph(entry, root, pages);
  const shared = sharedBare(root);
  const extraShared = shared.filter((id) => !SHARED_BARE_BUILTIN.includes(id));

  // 2) the shared chunk itself (the prelude every page runs on top of)
  const sharedPath = path.join(outDir, 'shared.js');
  const sharedResult = await esbuild.build({
    stdin: generatedEntry(sharedEntrySource(appModules, extraShared), root, 'fjs-shared'),
    bundle: true,
    outfile: sharedPath,
    format: 'iife',
    target: 'es2021',
    platform: 'neutral',
    minify: opts.minify,
    alias: flutterAliases(),
    plugins: [
      pagesPlugin(pages, 'app', false),
      pluginsPlugin(pluginsFor(root, 'app')),
      vueSfcPlugin(),
      vuePinPlugin(),
      srcAliasPlugin(root),
    ],
    define: VUE_DEFINES,
    metafile: opts.analyze,
    logLevel: 'warning',
    legalComments: 'none',
  });
  warnings.push(...sharedResult.warnings.map((w) => w.text));
  const metafiles: Record<string, Metafile> = {};
  if (sharedResult.metafile) metafiles[sharedPath] = sharedResult.metafile;

  // 3) the app entry and every page, all reading from __FJS_SHARED
  const stubbed = (): esbuild.Plugin[] => [
    vueSfcPlugin(),
    sharedStubPlugin(appModules, shared),
    srcAliasPlugin(root),
  ];
  const jsPath = path.join(outDir, 'bundle.js');
  const appResult = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    outfile: jsPath,
    format: 'iife',
    target: 'es2021',
    platform: 'neutral',
    minify: opts.minify,
    plugins: stubbed(),
    define: VUE_DEFINES,
    metafile: opts.analyze,
    logLevel: 'warning',
    legalComments: 'none',
  });
  warnings.push(...appResult.warnings.map((w) => w.text));
  if (appResult.metafile) metafiles[jsPath] = appResult.metafile;

  const pagesOut = path.join(outDir, 'pages');
  fs.mkdirSync(pagesOut, { recursive: true });
  const pageChunks: Record<string, string> = {};
  for (const page of pages) {
    const chunkPath = path.join(pagesOut, `${page.chunk}.js`);
    const pageResult = await esbuild.build({
      stdin: generatedEntry(pageChunkSource(page), root, `page-${page.chunk}`),
      bundle: true,
      outfile: chunkPath,
      format: 'iife',
      target: 'es2021',
      platform: 'neutral',
      minify: opts.minify,
      plugins: stubbed(),
      define: VUE_DEFINES,
      metafile: opts.analyze,
      logLevel: 'warning',
      legalComments: 'none',
    });
    warnings.push(...pageResult.warnings.map((w) => w.text));
    if (pageResult.metafile) metafiles[chunkPath] = pageResult.metafile;
    pageChunks[page.chunk] = chunkPath;
  }

  const res: BuildResult = { jsPath, sharedPath, pageChunks, warnings };
  if (opts.analyze) res.metafiles = metafiles;
  if (opts.bytecode) {
    res.bytecodePath = compileBytecode(jsPath, outDir, 'bundle');
    res.sharedBytecodePath = compileBytecode(sharedPath, outDir, 'shared');
    res.pageBytecodeChunks = {};
    for (const [chunk, file] of Object.entries(pageChunks)) {
      res.pageBytecodeChunks[chunk] = compileBytecode(file, pagesOut, chunk);
    }
  }
  return res;
}

// ---- web build (--web) -----------------------------------------------------

const INDEX_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>__TITLE__</title>
</head>
<body>
<div id="app"></div>
<script type="module" src="./main.js"></script>
</body>
</html>
`;

export function webTitle(root: string): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (typeof pkg.name === 'string' && pkg.name) return pkg.name;
  } catch {
    // no package.json — the directory name is a fine title
  }
  return path.basename(root);
}

async function buildWeb(opts: BuildOptions, outDir: string): Promise<BuildResult> {
  const root = process.cwd();
  const entry = path.resolve(opts.entry ?? 'src/main.ts');
  if (!fs.existsSync(entry)) throw new Error(`entry not found: ${entry}`);
  const webOut = path.join(outDir, 'web');
  fs.rmSync(webOut, { recursive: true, force: true });
  fs.mkdirSync(webOut, { recursive: true });

  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    outdir: webOut,
    entryNames: 'main',
    // ESM + splitting: each `() => import(page)` in the generated route
    // table becomes its own chunk, mirroring one .fjsbundle per page
    format: 'esm',
    splitting: true,
    target: 'es2020',
    platform: 'browser',
    minify: opts.minify,
    alias: webAliases(),
    plugins: [
      pagesPlugin(pagesFor(root, 'web'), 'web', false),
      pluginsPlugin(pluginsFor(root, 'web')),
      vueSfcPlugin({ web: true }),
      webPinPlugin(),
      srcAliasPlugin(root),
    ],
    define: VUE_DEFINES,
    loader: { '.png': 'file', '.jpg': 'file', '.svg': 'file', '.woff2': 'file' },
    metafile: opts.analyze,
    logLevel: 'warning',
    legalComments: 'none',
  });

  fs.writeFileSync(
    path.join(webOut, 'index.html'),
    INDEX_HTML.replace('__TITLE__', webTitle(root)),
  );
  const jsPath = path.join(webOut, 'main.js');
  return {
    jsPath,
    metafiles: result.metafile ? { [jsPath]: result.metafile } : undefined,
    warnings: result.warnings.map((w) => w.text),
  };
}

// ---- bytecode --------------------------------------------------------------

/** npm package carrying the prebuilt fjsc for the machine we are running on.
 * Installed as an optional dependency of @ufjs/cli; os/cpu in its manifest make
 * npm skip every package that does not match. */
export function fjscPackageName(): string {
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : process.arch;
  return `@ufjs/fjsc-${process.platform}-${arch}`;
}

/** Locates the fjsc binary: $FJSC_PATH, a repo checkout's own cmake build, or
 * the prebuilt npm package.
 *
 * The checkout wins over the npm package on purpose. @ufjs/cli declares the
 * prebuilt binary as an optional dependency, so a workspace install pulls it in
 * too — and someone editing packages/flutter_fjs/native would otherwise keep
 * compiling bundles with the *published* engine instead of the one they just
 * built. None of these paths can match from inside node_modules, so an
 * installed copy still lands on the npm package. */
export function findFjsc(): string | null {
  if (process.env.FJSC_PATH && fs.existsSync(process.env.FJSC_PATH)) {
    return process.env.FJSC_PATH;
  }

  const exe = process.platform === 'win32' ? 'fjsc.exe' : 'fjsc';
  const here = import.meta.dirname ?? '.';
  const candidates = [
    // running from packages/fjs/{src,dist} inside the monorepo checkout
    path.resolve(here, '..', '..', 'flutter_fjs', 'native', 'build-native', exe),
    path.resolve(here, '..', '..', '..', 'flutter_fjs', 'native', 'build-native', exe),
    // repo root as cwd
    path.resolve(process.cwd(), 'packages', 'flutter_fjs', 'native', 'build-native', exe),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  const require = createRequire(import.meta.url);
  try {
    // resolve the manifest, not bin/fjsc: a binary has no "exports" entry
    const manifest = require.resolve(`${fjscPackageName()}/package.json`);
    const binary = path.join(path.dirname(manifest), 'bin', exe);
    if (fs.existsSync(binary)) return binary;
  } catch {
    // no prebuilt package for this platform
  }
  return null;
}

export function compileBytecode(jsPath: string, outDir: string, baseName = 'app'): string {
  const fjsc = findFjsc();
  if (!fjsc) {
    throw new Error(
      `fjsc compiler not found — bytecode and release builds need it.\n` +
        `\n` +
        `It normally arrives with ${fjscPackageName()}, an optional dependency of\n` +
        `@ufjs/cli. If your platform has no prebuilt binary yet, build one from the\n` +
        `repository and point FJSC_PATH at it:\n` +
        `\n` +
        `  git clone https://github.com/snice/flutter-js && cd flutter-js\n` +
        `  node packages/fjsc/build.mjs\n` +
        `  export FJSC_PATH=$PWD/packages/fjsc/npm/fjsc-<platform>/bin/fjsc\n` +
        `\n` +
        `Reinstalling with the optional dependency enabled also works\n` +
        `(npm i --include=optional).`,
    );
  }
  const out = path.join(outDir, `${baseName}.fjsbundle`);
  const r = spawnSync(fjsc, [jsPath, out], { stdio: 'pipe' });
  if (r.status !== 0) {
    throw new Error(`fjsc failed:\n${r.stderr?.toString() ?? r.stdout?.toString()}`);
  }
  return out;
}

export async function buildCommand(argv: string[]): Promise<void> {
  const opts = parseBuildArgs(argv);
  if (opts.apk && !opts.release) {
    throw new Error('--apk requires --release or --profile');
  }
  if (opts.release) {
    if (opts.web) throw new Error('--release is for Flutter app builds; remove --web');
    opts.bytecode = true;
  }
  const t0 = Date.now();
  const res = await buildBundle(opts);
  for (const w of res.warnings) console.warn('  warn:', w);
  if (res.sharedPath) {
    console.log(`built ${res.sharedPath} (${fs.statSync(res.sharedPath).size} B, prelude)`);
  }
  console.log(`built ${res.jsPath} (${Date.now() - t0}ms)`);
  for (const [chunk, file] of Object.entries(res.pageChunks ?? {})) {
    console.log(`  page ${chunk} -> ${path.relative(process.cwd(), file)} (${fs.statSync(file).size} B)`);
  }
  if (res.bytecodePath) {
    const size = fs.statSync(res.bytecodePath).size;
    console.log(`built ${res.bytecodePath} (${size} bytes bytecode)`);
  }
  if (opts.release) {
    releaseBuild(opts, res);
  }
  if (opts.analyze) printAnalysis(res, opts.outDir);
}

export function releaseBuild(opts: BuildOptions, res: BuildResult): void {
  if (!res.bytecodePath) {
    throw new Error('release build needs bytecode output');
  }
  const root = process.cwd();
  const appName = projectName(root);
  const flutterDir = path.resolve(root, opts.flutterDir);
  ensureFlutterHost(flutterDir, appName);

  const assets = path.join(flutterDir, 'assets', 'fjs');
  const pagesOut = path.join(assets, 'pages');
  fs.rmSync(assets, { recursive: true, force: true });
  fs.mkdirSync(pagesOut, { recursive: true });

  const bundleAsset = copyReleaseAsset(res.bytecodePath, path.join(assets, 'bundle.fjsbundle'), opts.gz);

  const pages: Record<string, string> = {};
  let sharedAsset: string | null = null;
  if (res.sharedBytecodePath && res.pageBytecodeChunks) {
    sharedAsset = copyReleaseAsset(
      res.sharedBytecodePath,
      path.join(assets, 'shared.fjsbundle'),
      opts.gz,
    );
    for (const [chunk, file] of Object.entries(res.pageBytecodeChunks)) {
      const asset = copyReleaseAsset(file, path.join(pagesOut, `${chunk}.fjsbundle`), opts.gz);
      pages[chunk] = `assets/fjs/pages/${path.basename(asset)}`;
    }
  }
  const routes = pagesFor(root, 'app').map((page) => ({
    path: page.path,
    name: page.name,
    chunk: page.chunk,
    meta: page.meta,
  }));
  const manifest = {
    name: appName,
    entry: opts.entry ?? 'src/main.ts',
    split: Boolean(res.sharedBytecodePath),
    compression: opts.gz ? 'gzip' : null,
    shared: sharedAsset ? `assets/fjs/${path.basename(sharedAsset)}` : null,
    bundle: `assets/fjs/${path.basename(bundleAsset)}`,
    pages,
    routes,
  };
  fs.writeFileSync(
    path.join(assets, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  console.log(`synced release assets to ${path.relative(root, assets)}`);

  if (opts.apk) {
    const args = ['build', 'apk', ...flutterModeArgs(opts.mode, opts.flutterArgs), ...opts.flutterArgs];
    const result = spawnSync('flutter', args, { cwd: flutterDir, stdio: 'inherit' });
    if (result.status !== 0) throw new Error('flutter build apk failed');
    console.log(`built APK under ${path.relative(root, path.join(flutterDir, 'build', 'app', 'outputs', 'flutter-apk'))}`);
  }
}

function copyReleaseAsset(from: string, to: string, gzip: boolean): string {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  const raw = fs.readFileSync(from);
  if (!gzip) {
    fs.writeFileSync(to, raw);
    console.log(`  asset ${path.relative(process.cwd(), to)} (${raw.length} B raw)`);
    return to;
  }
  const gzPath = `${to}.gz`;
  const compressed = gzipSync(raw, { level: 9 });
  fs.writeFileSync(gzPath, compressed);
  const rel = path.relative(process.cwd(), gzPath);
  console.log(`  asset ${rel} (${compressed.length} B gzip, ${raw.length} B raw)`);
  return gzPath;
}
