// fjs modules: a unit of reuse that carries an API, components and — when
// it needs one — a Flutter side, and that can be published to npm as it is.
//
//   src/modules/<name>/          a module living in this project
//   node_modules/<name>/         the same thing installed from npm
//
// Both are described by their own package.json, and both are imported by
// their package name:
//
//   import { ping } from 'test';      // the API
//   <TestCard />                      // the components, registered globally
//
// The manifest is the `fjs` field of the module's package.json:
//
//   "fjs": {
//     "module": true,
//     "components": "components",       // dir of .vue files (default)
//     "componentPrefix": "Test",        // <TestCard />, default: PascalCase name
//     "widgets": {                      // tags backed by a Flutter widget
//       "test-chart": {
//         "web": "./components/TestChartWeb.vue",   // browser stand-in
//         "props": { "value": "number" }            // for the generated types
//       }
//     },
//     "prepare": "./prepare.mjs",       // build-time codegen, see below
//     "flutter": {                      // the autolinked Dart side
//       "package": "fjs_test",
//       "path": "./flutter",            // or "version": "^0.1.0"
//       "import": "package:fjs_test/fjs_test.dart",
//       "register": "FjsTest.register(engine)"
//     }
//   }
//
// The toolchain then does five things with it, none of which the app has
// to wire up: bare specifiers resolve (build aliases + generated types),
// the module's `prepare` hook runs before every build (see runPrepare),
// the components are registered on every Vue app (through 'fjs/plugins'),
// the API and component types are generated into src/fjs-modules.d.ts, and
// the Flutter side is autolinked into the generated host — the pubspec
// dependency and the `register` call, RN-style.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { Platform } from './pages.js';

export interface FjsModuleComponent {
  /** Global component name — `TestCard`. */
  name: string;
  /** Absolute path to the .vue file. */
  file: string;
}

/** A tag the module's Dart side renders with a real Flutter widget.
 *
 * The JS renderer already passes unknown tags through to the engine's
 * ComponentRegistry, so this declaration is what the *toolchain* needs: the
 * template compiler must treat the tag as an element rather than a
 * component, the web build needs the stand-in that replaces the widget in a
 * browser, and the editor needs its props. */
export interface FjsModuleWidget {
  /** The tag as templates write it — `<test-chart />`. */
  tag: string;
  /** Absolute path of the SFC the web build uses instead of the widget. */
  web?: string;
  /** Prop name -> TS type, for the generated GlobalComponents entry. All
   * optional, the way template props usually are. */
  props?: Record<string, string>;
}

export interface FjsModuleFlutter {
  /** pub package name — what the host's pubspec depends on. */
  package: string;
  /** Path to the Flutter package, relative to the module directory. */
  path?: string;
  /** Version constraint, when the package comes from pub.dev. */
  version?: string;
  /** Dart import the host needs, defaults to package:<package>/<package>.dart. */
  import?: string;
  /** Dart expression run before runApp, with `engine` in scope. */
  register?: string;
}

export interface FjsModule {
  /** Package name — the specifier app code imports. */
  name: string;
  /** Absolute path of the module's build-time codegen hook, if it has one. */
  prepare?: string;
  /** Absolute path to the module directory. */
  dir: string;
  /** Absolute path to the module entry. */
  entry: string;
  /** true for src/modules/*, false for an installed package. */
  local: boolean;
  components: FjsModuleComponent[];
  widgets: FjsModuleWidget[];
  flutter?: FjsModuleFlutter;
}

interface ManifestWidget {
  web?: string;
  props?: Record<string, string>;
}

interface ModuleManifest {
  module?: boolean;
  entry?: string;
  prepare?: string;
  components?: string | false;
  componentPrefix?: string;
  widgets?: Record<string, ManifestWidget | true>;
  flutter?: FjsModuleFlutter;
}

interface PackageJson {
  name?: string;
  main?: string;
  module?: string;
  types?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  fjs?: ModuleManifest & Record<string, unknown>;
}

export function modulesDir(root: string): string {
  return path.join(root, 'src', 'modules');
}

const ENTRY_CANDIDATES = ['index.ts', 'index.js', 'index.mts', 'index.mjs', 'index.vue'];

function readJson(file: string): PackageJson | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as PackageJson;
  } catch {
    return null;
  }
}

export function pascal(value: string): string {
  return value
    .replace(/^@[^/]+\//, '')
    .split(/[-_.\s/]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/** snake_case, which is what a Dart package name has to be. */
export function snake(value: string): string {
  return (
    value
      .replace(/^@[^/]+\//, '')
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/[-.\s/]+/g, '_')
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '') || 'fjs_module'
  );
}

function resolveEntry(dir: string, pkg: PackageJson | null): string | null {
  const declared = pkg?.fjs?.entry ?? pkg?.module ?? pkg?.main;
  if (declared) {
    const file = path.resolve(dir, declared);
    if (fs.existsSync(file)) return file;
  }
  for (const candidate of ENTRY_CANDIDATES) {
    const file = path.join(dir, candidate);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function walkVue(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkVue(full, out);
    else if (entry.name.endsWith('.vue')) out.push(full);
  }
  return out.sort();
}

function scanComponents(dir: string, manifest: ModuleManifest, name: string): FjsModuleComponent[] {
  if (manifest.components === false) return [];
  const rel = manifest.components ?? 'components';
  const prefix = manifest.componentPrefix ?? pascal(name);
  return walkVue(path.resolve(dir, rel)).map((file) => {
    const base = pascal(path.basename(file, '.vue'));
    // QrcodeView.vue in the "qrcode" module is <QrcodeView />, not
    // <QrcodeQrcodeView /> — a file already carrying the prefix keeps it
    return { name: base.startsWith(prefix) ? base : prefix + base, file };
  });
}

const TAG_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;

function scanWidgets(dir: string, manifest: ModuleManifest, moduleName: string): FjsModuleWidget[] {
  const declared = manifest.widgets;
  if (!declared) return [];
  return Object.entries(declared).map(([tag, value]) => {
    // a hyphen is what keeps a widget tag out of HTML's namespace — and out
    // of the fjs tag set, which the renderer resolves first
    if (!TAG_RE.test(tag)) {
      throw new Error(
        `module "${moduleName}": widget tag "${tag}" must be lowercase and hyphenated, ` +
          'like "test-chart"',
      );
    }
    const spec = value === true ? {} : value;
    const widget: FjsModuleWidget = { tag };
    if (spec.web) {
      const file = path.resolve(dir, spec.web);
      if (!fs.existsSync(file)) {
        throw new Error(
          `module "${moduleName}": widget "${tag}" declares a web fallback at ${spec.web}, ` +
            'which does not exist',
        );
      }
      widget.web = file;
    }
    if (spec.props) widget.props = spec.props;
    return widget;
  });
}

/** One module directory, or null when it does not look like a module. */
export function moduleFromDir(dir: string, local: boolean): FjsModule | null {
  const pkg = readJson(path.join(dir, 'package.json'));
  const manifest = pkg?.fjs ?? {};
  // An installed package must opt in; a directory under src/modules is one
  // by virtue of being there, so a hand-made module needs no manifest.
  if (!local && manifest.module !== true) return null;
  if (local && manifest.module === false) return null;
  const name = pkg?.name ?? path.basename(dir);
  const entry = resolveEntry(dir, pkg);
  if (!entry) return null;
  const prepare = manifest.prepare ? path.resolve(dir, manifest.prepare) : undefined;
  if (prepare && !fs.existsSync(prepare)) {
    throw new Error(
      `module "${name}": fjs.prepare points at ${manifest.prepare}, which does not exist`,
    );
  }
  const widgets = scanWidgets(dir, manifest, name);
  // a widget's web stand-in is registered under the widget's own tag, so it
  // is not also a component of its own
  const standIns = new Set(widgets.map((widget) => widget.web).filter(Boolean));
  const mod: FjsModule = {
    name,
    dir,
    entry,
    local,
    components: scanComponents(dir, manifest, name).filter(
      (component) => !standIns.has(component.file),
    ),
    widgets,
  };
  if (prepare) mod.prepare = prepare;
  if (manifest.flutter?.package) mod.flutter = manifest.flutter;
  return mod;
}

/** Modules that live in this project: src/modules/*. */
export function scanLocalModules(root: string): FjsModule[] {
  const dir = modulesDir(root);
  if (!fs.existsSync(dir)) return [];
  const out: FjsModule[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const mod = moduleFromDir(path.join(dir, entry.name), true);
    if (mod) out.push(mod);
  }
  return out;
}

/** Installed modules: dependencies whose package.json opts in with
 * `"fjs": { "module": true }`. This is the autolink scan — the same idea
 * as React Native's, one manifest field instead of a config file. */
export function scanInstalledModules(root: string): FjsModule[] {
  const pkg = readJson(path.join(root, 'package.json'));
  if (!pkg) return [];
  const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).sort();
  const require_ = createRequire(path.join(root, 'package.json'));
  const out: FjsModule[] = [];
  for (const name of names) {
    let dir: string | null = null;
    try {
      // the package's own manifest, following whatever node_modules layout
      // the installer produced (pnpm's symlinks included)
      dir = path.dirname(require_.resolve(`${name}/package.json`));
    } catch {
      // packages with an "exports" map that hides package.json
      const guess = path.join(root, 'node_modules', ...name.split('/'));
      if (fs.existsSync(path.join(guess, 'package.json'))) dir = guess;
    }
    if (!dir) continue;
    const mod = moduleFromDir(dir, false);
    if (mod) out.push(mod);
  }
  return out;
}

/** Every module the project can import, local ones first. A local module
 * shadows an installed package of the same name — the same rule as the
 * build aliases, which resolve local modules before node_modules. */
export function scanModules(root = process.cwd()): FjsModule[] {
  const local = scanLocalModules(root);
  const seen = new Set(local.map((m) => m.name));
  return [...local, ...scanInstalledModules(root).filter((m) => !seen.has(m.name))];
}

/** esbuild/Vite aliases for local modules: `import 'test'` -> the file.
 * Installed modules resolve on their own. */
export function moduleAliases(root: string, modules = scanModules(root)): Record<string, string> {
  const alias: Record<string, string> = {};
  for (const mod of modules) {
    if (mod.local) alias[mod.name] = mod.entry;
  }
  return alias;
}

/** Module names, which a split build treats as shared bare specifiers so
 * every page chunk sees one instance of the module's state. */
export function moduleNames(modules: FjsModule[]): string[] {
  return modules.map((mod) => mod.name);
}

/** Widget tags the template compiler must treat as elements rather than
 * components.
 *
 * On Flutter that is every declared widget: the renderer sends the tag to
 * the engine, which looks it up in the Dart ComponentRegistry. In a browser
 * there is no widget, so a tag with a web fallback goes the other way —
 * through component resolution, to the SFC registered under its name. A tag
 * without a fallback stays an element there too: an empty custom element is
 * a blank spot on the page, not a crash. */
export function widgetNativeTags(modules: FjsModule[], platform: 'app' | 'web'): string[] {
  const tags: string[] = [];
  for (const mod of modules) {
    for (const widget of mod.widgets) {
      if (platform === 'app' || !widget.web) tags.push(widget.tag);
    }
  }
  return tags;
}

/** Web stand-ins to register under their tag name, for the web build. */
export function widgetFallbacks(modules: FjsModule[]): { tag: string; file: string }[] {
  const out: { tag: string; file: string }[] = [];
  for (const mod of modules) {
    for (const widget of mod.widgets) {
      if (widget.web) out.push({ tag: widget.tag, file: widget.web });
    }
  }
  return out;
}

/** The app plugin that registers a module's components globally. Emitted
 * into the generated 'fjs/plugins' module, so an app that already passes
 * `plugins` to createFjsApp picks it up without changing a line. */
export function moduleComponentsSource(
  modules: FjsModule[],
  platform: 'app' | 'web' = 'app',
): {
  imports: string[];
  register: string[];
} {
  const imports: string[] = [];
  const register: string[] = [];
  let i = 0;
  const add = (name: string, file: string): void => {
    imports.push(`import __fc${i} from ${JSON.stringify(file)};`);
    register.push(`  app.component(${JSON.stringify(name)}, __fc${i});`);
    i++;
  };
  for (const mod of modules) {
    for (const component of mod.components) add(component.name, component.file);
  }
  // the web build's stand-ins for the Flutter widgets, registered under the
  // tag itself so the same template works on both targets
  if (platform === 'web') {
    for (const fallback of widgetFallbacks(modules)) add(fallback.tag, fallback.file);
  }
  return { imports, register };
}

// ---- prepare: a module's build-time codegen ---------------------------------
//
// Some modules cannot ship their data: it depends on the app using them —
// the icons a page draws, the locales it ships, the queries it sends. Making
// every app wire up a script for that is exactly the "second step" an
// installed module should not have. So a module can declare a hook:
//
//   "fjs": { "module": true, "prepare": "./prepare.mjs" }
//
// The toolchain runs it before every build, dev start and Vite start, with a
// context describing the project. Whatever it writes lands in
// `.fjs/modules/<name>/`, and both targets can read it from there:
//
//   * JS  — the module's own code imports `fjs/data/<file>`, which resolves
//     to that directory (a dynamic import therefore becomes its own chunk).
//   * Dart — `fjs run`/`fjs build --release` copy the directory into the
//     Flutter host's assets, so the module's Dart side reads
//     `assets/fjs/modules/<name>/<file>` from rootBundle.
//   * Types — a `types.d.ts` written there is referenced from the generated
//     src/fjs-modules.d.ts, so the app picks it up with no tsconfig edit.
//
// A prepare hook is module code running at build time, with the same trust
// as any bundler plugin an app installs: it is only ever run for modules the
// project depends on.

/** What a prepare hook is handed. Kept small and serialisable-looking on
 * purpose: a hook is a plain ESM module, not a plugin class. */
export interface PrepareContext {
  /** Project root. */
  root: string;
  /** Which build is being prepared. */
  platform: Platform;
  /** The module itself: its name and its directory. */
  module: { name: string; dir: string };
  /** Directory the hook writes into (already created). */
  outDir: string;
  /** The app's own source files — what a hook scans to find what is used.
   * Its own module directory is not included. */
  sources(): string[];
  /** Writes into [outDir], skipping the write when nothing changed (the dev
   * server watches this tree). Returns the absolute path. */
  write(name: string, contents: string): string;
  /** Prefixed console output, so a build says which module is talking. */
  log(...args: unknown[]): void;
}

/** Where a module's generated files live. */
export function moduleDataDir(root: string, name: string): string {
  return path.join(root, '.fjs', 'modules', name.replace(/^@[^/]+\//, ''));
}

const SOURCE_RE = /\.(?:vue|ts|tsx|js|jsx|mts|mjs)$/;

/** The app's source files: src/**, minus generated files and node_modules. */
function appSources(root: string, exclude: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (full === exclude) continue;
      if (entry.isDirectory()) walk(full);
      else if (SOURCE_RE.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full);
    }
  };
  walk(path.join(root, 'src'));
  return out.sort();
}

interface PrepareModule {
  default?: (ctx: PrepareContext) => void | Promise<void>;
}

/** Runs every module's prepare hook. Errors carry the module's name: a
 * failure here is the module's build step failing, not the app's. */
export async function runModulePrepare(
  root: string,
  platform: Platform,
  modules: FjsModule[] = scanModules(root),
): Promise<void> {
  for (const mod of modules) {
    if (!mod.prepare) continue;
    const outDir = moduleDataDir(root, mod.name);
    fs.mkdirSync(outDir, { recursive: true });
    const ctx: PrepareContext = {
      root,
      platform,
      module: { name: mod.name, dir: mod.dir },
      outDir,
      sources: () => appSources(root, mod.dir),
      write(name, contents) {
        const file = path.join(outDir, name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== contents) {
          fs.writeFileSync(file, contents);
        }
        return file;
      },
      log: (...args) => console.log(`[${mod.name}]`, ...args),
    };
    let hook: PrepareModule;
    try {
      // ESM caches by URL, and a dev server outlives an edit to the hook —
      // the file's stamp in the query is what makes a changed hook reload
      const stamp = fs.statSync(mod.prepare);
      const url = `${pathToFileURL(mod.prepare).href}?v=${stamp.mtimeMs}-${stamp.size}`;
      hook = (await import(url)) as PrepareModule;
    } catch (e) {
      throw new Error(
        `module "${mod.name}": prepare hook failed to load — ${
          e instanceof Error ? e.message : e
        }`,
      );
    }
    if (typeof hook.default !== 'function') {
      throw new Error(
        `module "${mod.name}": ${path.relative(root, mod.prepare)} must default-export a function`,
      );
    }
    try {
      await hook.default(ctx);
    } catch (e) {
      throw new Error(
        `module "${mod.name}": prepare failed — ${e instanceof Error ? e.message : e}`,
      );
    }
  }
}

/** Resolves the `fjs/data/<file>` a module imports: which module asked is
 * decided by the importer, so a module can only reach its own directory. */
export function resolveModuleData(
  root: string,
  modules: FjsModule[],
  importer: string,
  request: string,
): string | null {
  const file = request.replace(/^fjs\/data\//, '');
  if (!file || file.includes('..')) return null;
  const owner = modules.find((mod) => importer.startsWith(mod.dir + path.sep));
  if (!owner) return null;
  return path.join(moduleDataDir(root, owner.name), file);
}

// ---- generated types -------------------------------------------------------

export const MODULE_TYPES_FILE = path.join('src', 'fjs-modules.d.ts');
export const MODULE_COMPONENT_TYPES_FILE = path.join('src', 'fjs-components.d.ts');

/** Import specifier for a generated .d.ts: a path relative to src/, so it
 * resolves the same in the editor, in vue-tsc and under pnpm's symlinks. */
function typeRef(root: string, file: string): string {
  const from = path.join(root, 'src');
  const rel = path.relative(from, file).replace(/\\/g, '/').replace(/\.ts$/, '');
  return rel.startsWith('.') ? rel : `./${rel}`;
}

/** `src/fjs-modules.d.ts`: makes `import { x } from 'test'` resolve to the
 * module's own source, so completion and go-to-definition land in the real
 * file instead of an `any`.
 *
 * Local modules only — an installed package is found by node resolution
 * and brings its own types. This file must stay a *script* (no top-level
 * import/export): `declare module` in a module file is augmentation, which
 * requires the module to already resolve. */
export function moduleTypesSource(root: string, modules: FjsModule[]): string {
  // a prepare hook that wrote types.d.ts gets it into the program from here,
  // so the app needs no tsconfig entry for a directory it did not create
  const refs = modules
    .filter((mod) => fs.existsSync(path.join(moduleDataDir(root, mod.name), 'types.d.ts')))
    .map((mod) => {
      const file = path.join(moduleDataDir(root, mod.name), 'types.d.ts');
      const rel = path.relative(path.join(root, 'src'), file).replace(/\\/g, '/');
      return `/// <reference path=${JSON.stringify(rel)} />`;
    });
  const blocks = modules
    .filter((mod) => mod.local)
    .map((mod) => {
      const ref = JSON.stringify(typeRef(root, mod.entry));
      const source = fs.readFileSync(mod.entry, 'utf8');
      const lines = [
        `declare module ${JSON.stringify(mod.name)} {`,
        `  export * from ${ref};`,
        // `export *` on its own in an ambient module declares nothing —
        // TypeScript materialises the re-exports only once the body has a
        // second export. This type alias is that second export, and unlike a
        // synthesised default it invents no value the module does not have.
        `  export type __FjsModule = typeof import(${ref});`,
      ];
      if (/^\s*export\s+default\s/m.test(source)) {
        lines.push(`  export { default } from ${ref};`);
      }
      lines.push('}');
      return lines.join('\n');
    });
  const head = refs.length > 0 ? `${refs.join('\n')}\n\n` : '';
  return `// generated by fjs — do not edit\n\n${head}${blocks.join('\n\n')}\n`;
}

/** `src/fjs-components.d.ts`: the module components as GlobalComponents,
 * which is what makes `<TestCard />` complete and typecheck in a template
 * without an import. */
export function moduleComponentTypesSource(root: string, modules: FjsModule[]): string {
  const entries: string[] = [];
  let anyWidget = false;
  for (const mod of modules) {
    for (const component of mod.components) {
      entries.push(
        `    ${JSON.stringify(component.name)}: typeof import(${JSON.stringify(
          typeRef(root, component.file),
        )})['default'];`,
      );
    }
    for (const widget of mod.widgets) {
      anyWidget = true;
      // With a web stand-in the props are the stand-in's own — one
      // declaration for both targets. Without one, the manifest is all the
      // toolchain knows. Either way the tag also takes the base props and
      // the tap events, which on Flutter come from the widget's dispatch
      // rather than from any component.
      const props = widget.web
        ? `FjsWidgetProps<typeof import(${JSON.stringify(typeRef(root, widget.web))})['default']>`
        : `{ ${Object.entries(widget.props ?? {})
            .map(([name, type]) => `${JSON.stringify(name)}?: ${type}`)
            .join('; ')} }`;
      entries.push(`    ${JSON.stringify(widget.tag)}: FjsModuleWidget<${props}>;`);
    }
  }
  const helper = anyWidget
    ? `
/** A tag rendered by a Flutter widget: no component behind it on the app,
 * so the props are what the module documents plus the ones every fjs
 * element takes. */
type FjsModuleWidget<P> = {
  new (): {
    $props: P & {
      id?: string;
      class?: unknown;
      style?: unknown;
      key?: string | number;
      onTap?: () => void;
      onClick?: () => void;
      onLongPress?: () => void;
    };
    $slots: { default?: () => unknown };
  };
};

/** The props of a widget's web stand-in, so the tag is typed by the
 * component that renders it in a browser. */
type FjsWidgetProps<C> = C extends abstract new (...args: never[]) => { $props: infer P }
  ? P
  : Record<string, unknown>;
`
    : '';
  return `// generated by fjs — do not edit
export {};
${helper}
declare module 'vue' {
  export interface GlobalComponents {
${entries.join('\n')}
  }
}
`;
}

function writeIfChanged(file: string, source: string | null): void {
  if (source === null) {
    // nothing to declare any more: drop the file rather than leave a stale one
    if (fs.existsSync(file)) fs.rmSync(file);
    return;
  }
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === source) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source);
}

/** Writes both declaration files. Called wherever writeRouteTypes is —
 * every build, every dev server, and on change under Vite. */
export function writeModuleTypes(root: string, modules = scanModules(root)): void {
  const locals = modules.filter((mod) => mod.local);
  const dataTypes = modules.some((mod) =>
    fs.existsSync(path.join(moduleDataDir(root, mod.name), 'types.d.ts')),
  );
  const components = modules.some((mod) => mod.components.length + mod.widgets.length > 0);
  writeIfChanged(
    path.join(root, MODULE_TYPES_FILE),
    locals.length > 0 || dataTypes ? moduleTypesSource(root, modules) : null,
  );
  writeIfChanged(
    path.join(root, MODULE_COMPONENT_TYPES_FILE),
    components ? moduleComponentTypesSource(root, modules) : null,
  );
}

// ---- Flutter autolink ------------------------------------------------------

export interface AutolinkEntry {
  module: FjsModule;
  flutter: FjsModuleFlutter;
  /** Absolute path to the Flutter package, for a path dependency. */
  packageDir?: string;
  dartImport: string;
  register?: string;
}

/** Modules with a Flutter side, resolved against the project root. */
export function autolinkEntries(root: string, modules = scanModules(root)): AutolinkEntry[] {
  const out: AutolinkEntry[] = [];
  for (const mod of modules) {
    const flutter = mod.flutter;
    if (!flutter) continue;
    const entry: AutolinkEntry = {
      module: mod,
      flutter,
      dartImport: flutter.import ?? `package:${flutter.package}/${flutter.package}.dart`,
    };
    if (flutter.path) {
      const dir = path.resolve(mod.dir, flutter.path);
      if (!fs.existsSync(path.join(dir, 'pubspec.yaml'))) {
        throw new Error(
          `module "${mod.name}": fjs.flutter.path is ${flutter.path}, but there is no ` +
            `pubspec.yaml in ${dir}`,
        );
      }
      entry.packageDir = dir;
    } else if (!flutter.version) {
      throw new Error(
        `module "${mod.name}": fjs.flutter needs either a "path" or a "version"`,
      );
    }
    if (flutter.register) entry.register = flutter.register;
    out.push(entry);
  }
  return out;
}

/** The pubspec `dependencies:` lines for the autolinked modules. */
export function autolinkPubspecDeps(hostDir: string, entries: AutolinkEntry[]): string {
  return entries
    .map((entry) => {
      if (entry.packageDir) {
        let rel = path.relative(hostDir, entry.packageDir).replace(/\\/g, '/');
        if (!rel.startsWith('.')) rel = `./${rel}`;
        return `  ${entry.flutter.package}:\n    path: ${rel}\n`;
      }
      return `  ${entry.flutter.package}: ${entry.flutter.version}\n`;
    })
    .join('');
}

/** The host's Dart imports and the `register` calls that go before runApp. */
export function autolinkDart(entries: AutolinkEntry[]): { imports: string; registers: string } {
  const imports = entries
    .map((entry) => `import '${entry.dartImport}';\n`)
    .join('');
  const registers = entries
    .filter((entry) => entry.register)
    .map((entry) => `  ${entry.register!.replace(/;\s*$/, '')};\n`)
    .join('');
  return { imports, registers };
}
