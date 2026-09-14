// `fjs build --mp`: compile a Vue SFC project into a WeChat mini program
// (skyline renderer, glass-easel component framework).
//
// Output shape:
//
//   <outDir>/mp/
//     project.config.json          useCompilerPlugins: ["typescript"]
//     miniprogram/
//       app.ts / app.json / app.wxss / sitemap.json
//       fjs/runtime.ts                  vendor bundle: wx runtime + reactivity
//       fjs/routes.ts                   generated route table ('fjs/pages')
//       fjs/shared/<rel>                emitted local TS modules (theme.ts...)
//       fjs/{fjs-modal,icon-mind}/...   runtime-provided components
//       components/<name>/<name>.*      every compiled SFC (pages included)
//       pages/<route>/<route>.*         page wrappers (shell + page slot)
//
// Like the official TS quickstart this emits SOURCE modules (.ts) and lets
// DevTools' TypeScript compiler plugin do the transpile — no esbuild bundling
// of app code. Every SFC becomes one readable .ts module whose imports are
// rewritten to emitted locations; WeChat's module cache is what keeps the
// runtime and shared state (theme.ts) single-instance, which is why local
// modules are emitted once under fjs/shared/ and imported from there.
//
// Pages are wrapped, not rewritten: the wrapper mounts `<shell :route>
// <page/></shell>` exactly like createFjsApp does on the other platforms.
import fs from 'node:fs';
import { warn } from '../terminal/colors.js';
import path from 'node:path';
import { createHash } from 'node:crypto';
import esbuild from 'esbuild';
import { parse, compileScript } from '@vue/compiler-sfc';
import { runtimeDir } from '../bundler/vue-plugin.js';
import { scanPages } from '../project/pages.js';
import { scanLocalAssets } from '../project/assets.js';
import { moduleDataDir, runModulePrepare, scanModules, type FjsModule } from '../project/modules.js';
import { readAppConfig, readConfig } from '../project/config.js';
import { projectName } from '../commands/run.js';
import { genWxml, type TouchAction, type WxmlResult } from './wxml.js';
import { genScriptCode, shadowedGlobalsImport } from './script.js';
import { extractMedia, genWxss } from './css.js';
import {
  APP_WXSS,
  FJS_WXS,
  RUNTIME_COMPONENTS,
  SITEMAP_JSON,
  appJson,
  componentJson,
  copyRuntimeComponents,
  pageJson,
  projectConfigJson,
} from './project.js';

interface CompiledSfc {
  abs: string;
  /** output name (kebab), used for the components/<name>/ directory */
  name: string;
  scopeId: string;
  /** generated module source (TS, imports not yet rewritten) */
  moduleCode: string;
  wxml: string;
  wxss: string;
  /** usingComponents: kebab tag -> local SFC abs path or runtime name */
  usingComponents: Map<string, string>;
  /** set for page SFCs: they emit as pages/<name>/ with isPage registration */
  page?: { path: string; name: string; meta: Record<string, unknown> };
}

export interface MpOptions {
  root: string;
  outDir: string;
}

// ---- path helpers ------------------------------------------------------------

function scopeIdFor(root: string, abs: string): string {
  let rel = path.relative(root, abs);
  if (rel.startsWith('..')) rel = abs;
  return 'data-v-' + createHash('md5').update(rel).digest('hex').slice(0, 8);
}

function kebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
}

function resolveImport(root: string, importer: string, spec: string): string | null {
  let p: string;
  if (spec.startsWith('@/')) p = path.join(root, 'src', spec.slice(2));
  else if (spec.startsWith('.')) p = path.resolve(path.dirname(importer), spec);
  else return null;
  if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  for (const ext of ['.ts', '.js', '.vue', '/index.ts', '/index.js']) {
    if (fs.existsSync(p + ext)) return p + ext;
  }
  return null;
}

/** Relative import specifier from one emitted file to another, POSIX, with
 * the leading ./ for siblings (WeChat resolves extensionless to .ts). */
function relImport(fromDir: string, toFile: string): string {
  let rel = path.relative(fromDir, toFile).replace(/\\/g, '/');
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel.replace(/\.(ts|js)$/, '');
}

// ---- import rewriting ----------------------------------------------------------

/** Bare specifiers that resolve to the emitted runtime vendor bundle. */
const RUNTIME_BARE = new Set(['vue', '@ufjs/runtime/wx', 'fjs', 'fjs/router', 'fjs/vue']);
const IMAGE_RE = /\.(png|jpe?g|gif|svg|webp)$/;

export interface ImportResolution {
  kind: 'path' | 'const';
  /** 'path': the new specifier. 'const': the URL literal for the binding. */
  target: string;
}

/** Rewrites the module specifiers of every import statement (and drops
 * `import type`). Single-pass lexer: comments, strings and template
 * literals are skipped, so the word "import" in a comment never fires. */
export function rewriteImports(
  code: string,
  resolve: (spec: string) => ImportResolution | null,
): string {
  const out: string[] = [];
  let pos = 0; // emitted up to here
  let i = 0;

  const skipString = (quote: string): number => {
    let j = i + 1;
    while (j < code.length && code[j] !== quote) {
      if (code[j] === '\\') j++;
      j++;
    }
    return j + 1;
  };
  const skipComments = (): boolean => {
    if (code[i] === '/' && code[i + 1] === '/') {
      i = code.indexOf('\n', i);
      if (i < 0) i = code.length;
      return true;
    }
    if (code[i] === '/' && code[i + 1] === '*') {
      i = code.indexOf('*/', i) + 2;
      return true;
    }
    return false;
  };
  const isKw = (word: string): boolean =>
    code.startsWith(word, i) && !/[A-Za-z0-9_$]/.test(code[i - 1] ?? '') && !/[A-Za-z0-9_$]/.test(code[i + word.length] ?? '');

  while (i < code.length) {
    if (skipComments()) continue;
    const ch = code[i];
    if (ch === '"' || ch === "'") {
      i = skipString(ch);
      continue;
    }
    if (ch === '`') {
      // template literal: nested ${ } may contain strings/braces
      i++;
      let depth = 0;
      while (i < code.length && (depth > 0 || code[i] !== '`')) {
        if (code[i] === '$' && code[i + 1] === '{') {
          depth++;
          i += 2;
          continue;
        }
        if (depth > 0 && code[i] === '}') depth--;
        if (code[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (isKw('import') || isKw('export')) {
      const kw = code.startsWith('import', i) ? 'import' : 'export';
      const kwStart = i;
      i += kw.length;
      // dynamic import( and bare keywords are left alone
      let j = i;
      while (j < code.length && /\s/.test(code[j])) j++;
      if (kw === 'import' && code[j] === '(') continue;
      // find the module specifier: first string literal from here
      while (i < code.length) {
        if (skipComments()) continue;
        const c = code[i];
        if (c === '"' || c === "'") {
          // an `export` is only a module statement when its specifier is
          // directly preceded by `from` (export const/interface are not)
          if (kw === 'export' && !/\bfrom\s*$/.test(code.slice(kwStart, i))) {
            i++;
            continue;
          }
          const specStart = i + 1;
          const specEnd = skipString(c) - 1;
          const spec = code.slice(specStart, specEnd);
          // `import type` is fully erased by the TS compile — drop it
          const clause = code.slice(kwStart, specStart - 1);
          if (kw === 'import' && /^\s*import\s+type\b/.test(clause)) {
            let stmtEnd = specEnd + 1;
            if (code[stmtEnd] === ';') stmtEnd++;
            out.push(code.slice(pos, kwStart));
            pos = stmtEnd;
            i = stmtEnd;
            break;
          }
          const resolved = resolve(spec);
          if (!resolved) {
            i = specEnd + 1;
            break;
          }
          if (resolved.kind === 'path') {
            out.push(code.slice(pos, specStart));
            out.push(resolved.target);
            pos = specEnd;
            i = specEnd + 1;
          } else {
            // asset: replace the statement with a URL constant bound to
            // the default import name
            let stmtEnd = specEnd + 1;
            if (code[stmtEnd] === ';') stmtEnd++;
            const named = /import\s+([A-Za-z_$][\w$]*)\s+from\s*$/.exec(code.slice(kwStart, specStart - 1));
            if (!named) {
              throw new Error(
                `[fjs/mp] asset import "${spec}" must use a default import (import img from '...')`,
              );
            }
            out.push(code.slice(pos, kwStart));
            out.push(`const ${named[1]} = ${resolved.target};`);
            pos = stmtEnd;
            i = stmtEnd;
          }
          break;
        }
        i++;
      }
      continue;
    }
    i++;
  }
  out.push(code.slice(pos));
  return out.join('');
}

// ---- SFC compilation -----------------------------------------------------------

function kebabTagName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
}

class SfcCompiler {
  readonly cache = new Map<string, CompiledSfc>();
  private readonly root: string;
  private readonly moduleTags: Set<string>;
  /** kebab tags removed from emission (fjs.mp.excludeComponents) */
  private readonly stripTags: Set<string>;
  /** The app shell: its template root fills the page (wxml.ts rootClass). */
  shellAbs?: string;
  /** app.config wxmp.renderer (wxml.ts: gesture handlers on skyline) */
  renderer: 'webview' | 'skyline' = 'webview';

  constructor(root: string, moduleTags: Set<string>, stripTags: Set<string>) {
    this.root = root;
    this.moduleTags = moduleTags;
    this.stripTags = stripTags;
  }

  /** Compiles (once) and records the SFC, following local component imports.
   * `page` marks a route SFC: it emits as a page, not a component. */
  async compile(abs: string, page?: { path: string; name: string; meta: Record<string, unknown> }): Promise<CompiledSfc> {
    const cached = this.cache.get(abs);
    if (cached) return cached;
    const filename = path.basename(abs);
    const source = fs.readFileSync(abs, 'utf8');
    const { descriptor, errors } = parse(source, { filename });
    if (errors.length) {
      throw new Error(`${abs}: ${errors.map((e) => String(e.message ?? e)).join('; ')}`);
    }
    const scopeId = scopeIdFor(this.root, abs);
    const name = kebabTagName(path.basename(abs).replace(/\.vue$/, ''));

    let content = '';
    let bindings: Record<string, string> = {};
    if (descriptor.script || descriptor.scriptSetup) {
      const compiled = compileScript(descriptor, { id: scopeId });
      content = compiled.content;
      bindings = (compiled.bindings ?? {}) as Record<string, string>;
    }

    // local SFC imports become usingComponents entries
    const vueImports = new Map<string, string>();
    for (const m of content.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+\.vue)['"]/g)) {
      const resolved = resolveImport(this.root, abs, m[2]);
      if (resolved) vueImports.set(m[1], resolved);
    }

    // @media blocks become runtime-evaluated classes (css.ts extractMedia);
    // every class scan below reads the unwrapped blocks, so a rule inside a
    // media block never passes for the element's base style
    const media = extractMedia(descriptor.styles, filename);
    const styles = media.styles;

    // classes whose rules set `height` — the scroll-view check accepts them
    const heightClasses = new Set<string>();
    for (const style of styles) {
      for (const m of style.content.matchAll(/\.([A-Za-z_][\w-]*)[^{}]*\{[^}]*\bheight\s*:/g)) {
        heightClasses.add(m[1]);
      }
    }

    // column containers that center / end-align their children, and
    // classes that give an element a visible box (wxml.ts textFillClass)
    const crossAlignClasses = new Map<string, 'center' | 'end'>();
    const boxedClasses = new Set<string>();
    // flex layout declarations per class, for wrappers that must repeat
    // their host's layout (wxml.ts layoutStyleOf)
    const layoutClasses = new Map<string, string>();
    const horizontalClasses = new Set<string>();
    const touchActionClasses = new Map<string, TouchAction>();
    const colorClasses = new Map<string, string>();
    const activeClasses = new Set<string>();
    for (const style of styles) {
      for (const m of style.content.matchAll(/((?:\.[A-Za-z_][\w-]*)+):active\b/g)) {
        for (const c of m[1].split('.').filter(Boolean)) activeClasses.add(c);
      }
    }
    for (const style of styles) {
      for (const m of style.content.matchAll(/\.([A-Za-z_][\w-]*)\s*\{([^}]*)\}/g)) {
        const body = m[2];
        if (/(^|;|\s)direction\s*:\s*horizontal/.test(body)) horizontalClasses.add(m[1]);
        const touchAction = /(?:^|;|\s)touch-action\s*:\s*(none|pan-x|pan-y)\b/.exec(body);
        if (touchAction) touchActionClasses.set(m[1], touchAction[1] as TouchAction);
        const color = /(?:^|;|\s)color\s*:\s*([^;]+)/.exec(body);
        if (color) colorClasses.set(m[1], color[1].trim());
        const layout = [...body.matchAll(/(?:^|;|\s)((?:flex-direction|flex-wrap|align-items|justify-content|gap|row-gap|column-gap)\s*:\s*[^;]+)/g)]
          .map((d) => d[1].trim())
          .join('; ');
        if (layout) layoutClasses.set(m[1], (layoutClasses.get(m[1]) ? layoutClasses.get(m[1]) + '; ' : '') + layout);
        if (/flex-direction\s*:\s*row/.test(body)) continue;
        const align = /align-items\s*:\s*(center|flex-end|end)\b/.exec(body);
        if (align) crossAlignClasses.set(m[1], align[1] === 'center' ? 'center' : 'end');
        if (/\b(background(-color)?|border(-\w+)?|padding(-\w+)?|width|max-width|align-self)\s*:/.test(body)) {
          boxedClasses.add(m[1]);
        }
      }
    }

    const numericBindings = new Set<string>();
    const scriptSrc = (descriptor.scriptSetup?.content ?? '') + (descriptor.script?.content ?? '');
    for (const m of scriptSrc.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:ref\s*(?:<[^>]*>)?\(\s*)?-?\d/g)) {
      numericBindings.add(m[1]);
    }

    const wxml: WxmlResult = descriptor.template
      ? genWxml(descriptor.template.content, {
          bindings,
          vueImports,
          moduleTags: this.moduleTags,
          stripTags: this.stripTags,
          heightClasses,
          // the shell's root element (or a page's, when there is no shell)
          // fills the page, as the root does on web and Flutter
          rootClass: abs === this.shellAbs || (page && !this.shellAbs) ? 'fjs-page-root' : undefined,
          // Shell.vue wraps a page in its scrolling body unless the route
          // says `scroll: false` (the page manages its own scrolling)
          pageInScroll: !!page && !!this.shellAbs && page.meta.scroll !== false,
          crossAlignClasses,
          boxedClasses,
          layoutClasses,
          horizontalClasses,
          touchActionClasses,
          renderer: this.renderer,
          colorClasses,
          activeClasses,
          mediaClasses: media.classes,
          numericBindings,
          filename,
          scopeId,
        })
      : { wxml: '', setupCode: [], returnedNames: [], dataNames: [], usesWxs: false, usingComponents: new Map(), fjsClasses: [] };

    const moduleCode = genScriptCode({
      compiled: { content, bindings },
      wxml,
      kind: page ? 'page' : 'component',
      route: page,
      filename,
      media: media.conditions,
    });
    const wxss = genWxss({
      styles: styles,
      id: scopeId,
      filename,
      fjsClasses: wxml.fjsClasses,
    });

    const result: CompiledSfc = {
      abs,
      name,
      scopeId,
      moduleCode,
      wxml: wxml.wxml,
      wxss,
      usingComponents: wxml.usingComponents,
      page,
    };
    this.cache.set(abs, result);
    // closure: local components used by this one
    for (const dep of result.usingComponents.values()) {
      if (path.isAbsolute(dep)) await this.compile(dep);
    }
    return result;
  }
}

// ---- emission ------------------------------------------------------------------

/** Emits app modules as SOURCE (.ts): SFC modules, local TS/JS dependencies
 * and static assets. Imports are rewritten to emitted locations; WeChat's
 * module cache provides the single-instance semantics the bundler used to. */
class Emitter {
  /** abs of a local non-SFC module -> its emitted file (fjs/shared/<rel>) */
  private localModules = new Map<string, string>();
  private localQueue: Array<{ abs: string; out: string }> = [];
  /** abs of an asset -> its emitted root-absolute URL (/assets/<name>) */
  private assets = new Map<string, string>();

  constructor(
    private readonly root: string,
    private readonly mpDir: string,
  ) {}

  /** Resolves one specifier for a module being emitted from `fromDir`
   * (output location) whose source lives at `fromAbs` (source location). */
  resolveFor(fromDir: string, fromAbs: string, spec: string): ImportResolution | null {
    const runtimeTs = path.join(this.mpDir, 'fjs', 'runtime.ts');
    const routesTs = path.join(this.mpDir, 'fjs', 'routes.ts');
    if (RUNTIME_BARE.has(spec)) return { kind: 'path', target: relImport(fromDir, runtimeTs) };
    if (spec === 'fjs/pages') return { kind: 'path', target: relImport(fromDir, routesTs) };
    if (IMAGE_RE.test(spec)) {
      return { kind: 'const', target: this.assetUrl(fromAbs, spec) };
    }
    if (!spec.startsWith('@/') && !spec.startsWith('.')) {
      throw new Error(
        `[fjs/mp] bare import "${spec}" cannot run on the mini-program target ` +
          `(no node_modules) — import it from 'fjs' / '@ufjs/runtime/wx' or exclude the page`,
      );
    }
    const abs = resolveImport(this.root, fromAbs, spec);
    if (!abs) throw new Error(`[fjs/mp] cannot resolve "${spec}" imported by ${fromAbs}`);
    if (abs.endsWith('.vue')) {
      // no JS-level component imports (see the null-comment above)
      return { kind: 'const', target: 'null' };
    }
    // local TS/JS module: emitted once under fjs/shared/<path-from-src>
    const out = this.localModuleOut(abs);
    return { kind: 'path', target: relImport(fromDir, out) };
  }

  /** The asset URL for an image specifier, registering the file copy.
   * `fromAbs` disambiguates the specifier (it may be relative). */
  private assetUrl(fromAbs: string, spec: string): string {
    const abs = spec.startsWith('@/')
      ? path.join(this.root, 'src', spec.slice(2))
      : path.resolve(path.dirname(fromAbs), spec);
    const existing = this.assets.get(abs);
    if (existing) return existing;
    const ext = path.extname(abs);
    const name = `${path.basename(abs, ext)}-${createHash('md5').update(abs).digest('hex').slice(0, 6)}${ext}`;
    // raw path (this map also drives the file copy); the QUOTED literal is
    // only for the emitted import target
    const url = `/assets/${name}`;
    this.assets.set(abs, url);
    return JSON.stringify(url);
  }

  private localModuleOut(abs: string): string {
    const existing = this.localModules.get(abs);
    if (existing) return existing;
    const rel = path.relative(path.join(this.root, 'src'), abs);
    if (rel.startsWith('..')) {
      throw new Error(`[fjs/mp] local module outside src/ is not supported: ${abs}`);
    }
    const out = path.join(this.mpDir, 'fjs', 'shared', rel).replace(/\.(ts|js)$/, '.ts');
    this.localModules.set(abs, out);
    this.localQueue.push({ abs, out });
    return out;
  }

  /** Emits every queued local module (imports rewritten recursively). */
  flushLocalModules(): void {
    while (this.localQueue.length) {
      const { abs, out } = this.localQueue.shift()!;
      const source = fs.readFileSync(abs, 'utf8');
      const rewritten = rewriteImports(shadowedGlobalsImport(source) + source, (spec) =>
        this.resolveFor(path.dirname(out), abs, spec),
      );
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, `// emitted by fjs from ${path.relative(this.root, abs)}\n${rewritten}`);
    }
  }

  writeAssets(): void {
    for (const [abs, url] of this.assets) {
      const dest = path.join(this.mpDir, url);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(abs, dest);
    }
  }
}

const MP_DEFINES = {
  'process.env.NODE_ENV': '"production"',
  __VUE_OPTIONS_API__: 'true',
  __VUE_PROD_DEVTOOLS__: 'false',
  __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
};

// ---- orchestration -----------------------------------------------------------

export async function mpBuild(opts: MpOptions): Promise<void> {
  const { root } = opts;
  const config = readConfig(root);
  const mpConfig = config.mp ?? {};
  const appConfig = readAppConfig(root);
  const outRoot = path.resolve(root, opts.outDir, 'mp');
  const mpDir = path.join(outRoot, 'miniprogram');
  const componentsDir = path.join(mpDir, 'components');
  const pagesOutDir = path.join(mpDir, 'pages');
  fs.rmSync(outRoot, { recursive: true, force: true });
  fs.mkdirSync(componentsDir, { recursive: true });
  fs.mkdirSync(pagesOutDir, { recursive: true });

  // pages: route scan + exclusion list
  const excluded = mpConfig.exclude ?? [];
  const pages = scanPages(root)
    .filter((p) => !excluded.some((frag) => p.path === frag || p.path.includes(frag) || p.name === frag))
    .map((p) => ({ path: p.path, name: p.name, meta: p.meta, file: p.file }));
  pages.sort((a, b) => (a.path === '/' ? -1 : b.path === '/' ? 1 : a.path.localeCompare(b.path)));

  const shellAbs = resolveImport(root, path.join(root, 'package.json'), mpConfig.shell ?? '@/Shell.vue');

  // module widgets with an mp component: the tag compiles as a custom
  // component whose four-pack is copied straight out of the module package
  // (the same npm package that carries the web stand-in and Flutter widget)
  const modules = scanModules(root);
  // a module's generated data (the icons a page names…) is as much part of
  // the mp build as of the other two; the web's copy is the same data
  await runModulePrepare(root, 'web', modules);
  const moduleWidgets = new Map<string, { module: FjsModule; mpBase: string }>();
  for (const mod of modules) {
    for (const widget of mod.widgets) {
      if (widget.mp) moduleWidgets.set(widget.tag, { module: mod, mpBase: widget.mp });
    }
  }

  // fjs.mp.excludeComponents: local SFCs removed from the mp emission —
  // the app's custom TabBar when the native tabBar takes over (Flutter/Web
  // keep rendering it, so the source stays shared)
  const excludedComponents = new Set<string>();
  for (const spec of mpConfig.excludeComponents ?? []) {
    const abs = resolveImport(root, path.join(root, 'package.json'), spec);
    if (abs?.endsWith('.vue')) {
      excludedComponents.add(kebabTagName(path.basename(abs).replace(/\.vue$/, '')));
    } else {
      warn(`[fjs/mp] excludeComponents entry "${spec}" is not a resolvable .vue — skipped`);
    }
  }

  // compile every SFC once: pages (as pages), their local components, the
  // shell tree
  const compiler = new SfcCompiler(root, new Set(moduleWidgets.keys()), excludedComponents);
  compiler.shellAbs = shellAbs ?? undefined;
  compiler.renderer = appConfig.wxmp?.renderer ?? 'webview';
  for (const p of pages) {
    await compiler.compile(p.file, { path: p.path, name: p.name, meta: p.meta });
  }
  if (shellAbs) await compiler.compile(shellAbs);

  const emitter = new Emitter(root, mpDir);

  // vendor runtime: the wx runtime + the 'fjs' bridge + reactivity, one CJS
  // module imported by every emitted file. Plain JS carried in a .ts name so
  // extensionless imports resolve like every other emitted module.
  const rtd = runtimeDir();
  fs.mkdirSync(path.join(mpDir, 'fjs'), { recursive: true });
  await esbuild.build({
    stdin: {
      contents: [
        `export * from ${JSON.stringify(path.join(rtd, 'src', 'wx', 'index.ts'))};`,
        `export * from ${JSON.stringify(path.join(rtd, 'src', 'wx', 'fjs-bridge.ts'))};`,
      ].join('\n'),
      resolveDir: root,
      sourcefile: 'fjs-mp-runtime.ts',
      loader: 'ts',
    },
    outfile: path.join(mpDir, 'fjs', 'runtime.ts'),
    bundle: true,
    format: 'cjs',
    target: 'es2018',
    platform: 'neutral',
    minify: false,
    define: MP_DEFINES,
    logLevel: 'silent',
  });

  // route table ('fjs/pages' on wx)
  fs.writeFileSync(
    path.join(mpDir, 'fjs', 'routes.ts'),
    '// generated by fjs — do not edit\n' +
      `export const routes = ${JSON.stringify(
        pages.map(({ path, name, meta }) => ({ path, name, meta })),
        null,
        2,
      )};\nexport default routes;\n`,
  );

  const writeComponent = (sfc: CompiledSfc, outDir: string, outName: string): void => {
    fs.mkdirSync(outDir, { recursive: true });
    const code = rewriteImports(sfc.moduleCode, (spec) =>
      emitter.resolveFor(outDir, sfc.abs, spec),
    );
    fs.writeFileSync(path.join(outDir, `${outName}.ts`), code);
    fs.writeFileSync(path.join(outDir, `${outName}.wxml`), sfc.wxml);
    fs.writeFileSync(path.join(outDir, `${outName}.wxss`), sfc.wxss);
  };
  // '@ufjs/iconmind' -> 'iconmind': a package name is not a path-safe dir name
  const moduleDirName = (name: string): string => name.split('/').pop() ?? name;
  const moduleComponentOut = (tag: string): string =>
    `/fjs/modules/${moduleDirName(moduleWidgets.get(tag)!.module.name)}/${tag}/${tag}`;
  const usingComponentsPaths = (sfc: CompiledSfc): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [tag, target] of sfc.usingComponents) {
      if (target.startsWith('module:')) {
        out[tag] = moduleComponentOut(tag);
      } else if (path.isAbsolute(target)) {
        const dep = compiler.cache.get(target);
        out[tag] = `/components/${dep?.name ?? tag}/${dep?.name ?? tag}`;
      } else if (RUNTIME_COMPONENTS[target]) {
        out[tag] = '/' + RUNTIME_COMPONENTS[target];
      }
    }
    return out;
  };
  for (const sfc of compiler.cache.values()) {
    if (sfc.page) continue;
    const outDir = path.join(componentsDir, sfc.name);
    writeComponent(sfc, outDir, sfc.name);
    fs.writeFileSync(path.join(outDir, `${sfc.name}.json`), componentJson(usingComponentsPaths(sfc)));
  }

  // pages: the route SFC IS the Component()-constructed page — its module
  // registers with isPage and its wxml wraps the shell around its own
  // elements (the same composition createFjsApp does on the other platforms)
  const shellName = shellAbs ? compiler.cache.get(shellAbs)?.name : undefined;
  for (const p of pages) {
    const pageSfc = compiler.cache.get(p.file);
    if (!pageSfc) continue;
    const dir = path.join(pagesOutDir, p.name);
    fs.mkdirSync(dir, { recursive: true });
    const using: Record<string, string> = {};
    if (shellName) using.shell = `/components/${shellName}/${shellName}`;
    for (const [tag, target] of Object.entries(usingComponentsPaths(pageSfc))) {
      using[tag] = target;
    }
    // .fjs-page-host carries the height chain: percent lengths and :host
    // are not reliable under skyline (see APP_WXSS)
    const wxml =
      shellName
        ? `<view class="fjs-page-host">\n<shell route="{{ __fjsRoute }}">\n${pageSfc.wxml}</shell>\n</view>\n`
        : `<view class="fjs-page-host">\n${pageSfc.wxml}</view>\n`;
    fs.writeFileSync(path.join(dir, `${p.name}.wxml`), wxml);
    fs.writeFileSync(path.join(dir, `${p.name}.wxss`), pageSfc.wxss);
    fs.writeFileSync(path.join(dir, `${p.name}.json`), pageJson(using));
    const code = rewriteImports(pageSfc.moduleCode, (spec) =>
      emitter.resolveFor(dir, pageSfc.abs, spec),
    );
    fs.writeFileSync(path.join(dir, `${p.name}.ts`), code);
  }

  // module-provided component four-packs, plus the module's prepare output:
  // every .json it generated becomes fjs/modules/<module>/data/<file>.js
  // (CommonJS — a mini-program component can require JS, not JSON), so the
  // component reads it with require('../data/icons.json.js')
  const withData = new Set<FjsModule>();
  for (const { module } of moduleWidgets.values()) withData.add(module);
  for (const module of withData) {
    const src = moduleDataDir(root, module.name);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(mpDir, 'fjs', 'modules', moduleDirName(module.name), 'data');
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      if (!entry.endsWith('.json')) continue;
      const json = fs.readFileSync(path.join(src, entry), 'utf8');
      fs.writeFileSync(path.join(dest, `${entry}.js`), `// generated by fjs from the module's prepare output\nmodule.exports = ${json.trim()};\n`);
    }
  }
  for (const [tag, { module, mpBase }] of moduleWidgets) {
    const dest = path.join(mpDir, 'fjs', 'modules', moduleDirName(module.name), tag);
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(path.dirname(mpBase))) {
      if (entry.startsWith(path.basename(mpBase) + '.')) {
        fs.copyFileSync(path.join(path.dirname(mpBase), entry), path.join(dest, entry));
      }
    }
  }

  // local modules + assets, then the app-level files
  emitter.flushLocalModules();
  emitter.writeAssets();
  // public/ images keep their root-absolute URLs (/images/x.png), vite's
  // contract on the web — the miniprogram root is that root here
  for (const url of scanLocalAssets(root).images) {
    const dest = path.join(mpDir, url);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(root, 'public', url), dest);
  }
  fs.writeFileSync(
    path.join(mpDir, 'app.ts'),
    '// generated by fjs — importing the runtime installs the fetch polyfill;\n' +
      '// the route table it hands over is what router.push resolves against\n' +
      `import '${relImport(mpDir, path.join(mpDir, 'fjs', 'runtime.ts'))}';\n` +
      `import { routes as __fjsRoutes } from '${relImport(mpDir, path.join(mpDir, 'fjs', 'routes.ts'))}';\n` +
      `import { registerRoutes as __fjsRegisterRoutes } from '${relImport(mpDir, path.join(mpDir, 'fjs', 'runtime.ts'))}';\n` +
      `__fjsRegisterRoutes(__fjsRoutes);\nApp({});\n`,
  );
  // renderer defaults to webview (see WxmpHostConfig): skyline keys only
  // appear when explicitly chosen
  const renderer = appConfig.wxmp?.renderer ?? 'webview';
  fs.writeFileSync(path.join(mpDir, 'app.json'), appJson(pages, renderer));
  fs.writeFileSync(path.join(mpDir, 'app.wxss'), APP_WXSS);
  fs.writeFileSync(path.join(mpDir, 'sitemap.json'), SITEMAP_JSON);
  fs.writeFileSync(
    path.join(outRoot, 'project.config.json'),
    projectConfigJson(
      projectName(root),
      appConfig.wxmp?.appid ?? mpConfig.appid,
      renderer,
      appConfig.wxmp?.setting,
    ),
  );
  copyRuntimeComponents(rtd, mpDir);
  fs.writeFileSync(path.join(mpDir, 'fjs', 'fjs.wxs'), FJS_WXS);

  console.log(
    `fjs mp: ${pages.length} pages, ${compiler.cache.size} components -> ${path.relative(root, outRoot)}`,
  );
  if (pages.length) {
    console.log('open dist/mp in WeChat DevTools (skyline + glass-easel)');
  }
}
