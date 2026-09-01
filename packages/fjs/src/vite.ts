// Vite adapter for fjs apps. Runtime/native builds still go through
// `fjs build`; this plugin makes the same Vue/pages app run as a normal
// browser app during Vite dev/build.
import { pagesFor, routeTableSource, writeRouteTypes } from './project/pages.js';
import { pluginTableSource, pluginsFor } from './project/plugins.js';
import { runtimeDir, webIsNativeTag } from './bundler/vue-plugin.js';
import { rewriteFjsCss } from '../../fjs-runtime/src/web/css-compat.js';
import path from 'node:path';

const VIRTUAL_PAGES = '\0fjs-pages';
const VIRTUAL_PLUGINS = '\0fjs-plugins';
const VUE_ROUTE_BLOCK_RE = /\.vue\?vue&type=route(?:&|$)/;
const VUE_STYLE_BLOCK_RE = /\.vue\?vue&type=style(?:&|$)/;

interface ViteConfig {
  root?: string;
}

/** The public surface of @vitejs/plugin-vue's `api`, which is a documented
 * extension point: other plugins read and write the options it compiles
 * with. Only the parts this needs are typed. */
interface VuePluginApi {
  options: {
    template?: { compilerOptions?: Record<string, unknown> } & Record<string, unknown>;
  } & Record<string, unknown>;
}

interface ResolvedViteConfig {
  plugins: readonly { name: string; api?: unknown }[];
}

interface ViteServer {
  moduleGraph: {
    getModuleById(id: string): unknown;
    invalidateModule(mod: unknown): void;
  };
}

interface HotUpdateContext {
  file: string;
  server: ViteServer;
}

interface VitePlugin {
  name: string;
  enforce: 'pre';
  config(config: ViteConfig): object;
  configResolved(config: ResolvedViteConfig): void;
  resolveId(id: string): string | null;
  load(id: string): string | null;
  transform(code: string, id: string): string | null;
  handleHotUpdate(ctx: HotUpdateContext): void;
}

export function fjs(): VitePlugin {
  let root = process.cwd();
  return {
    name: 'fjs-vite',
    enforce: 'pre',
    config(config) {
      root = config.root ? path.resolve(config.root) : process.cwd();
      writeRouteTypes(root);
      const runtime = runtimeDir();
      return {
        resolve: {
          alias: [
            // `@/x` -> `<root>/src/x`, matching what `fjs build` resolves.
            { find: /^@\//, replacement: `${path.join(root, 'src')}/` },
            { find: /^fjs\/app$/, replacement: path.join(runtime, 'src', 'app', 'web.ts') },
            { find: /^fjs\/router$/, replacement: path.join(runtime, 'src', 'router', 'web.ts') },
            { find: /^fjs\/web$/, replacement: path.join(runtime, 'src', 'web', 'index.ts') },
            { find: /^fjs\/vue$/, replacement: path.join(runtime, 'src', 'vue', 'index.ts') },
            { find: /^fjs$/, replacement: path.join(runtime, 'src', 'index.ts') },
          ],
        },
      };
    },
    // @vitejs/plugin-vue compiles with compiler-dom's defaults, under which
    // <view>, <text>, <image>, <switch>, <input>, <button> and <progress>
    // are native tags: they would render verbatim and `@tap` would become a
    // listener for a DOM event named "tap" that nothing ever fires. The
    // esbuild web build passes the same predicate to compileTemplate; here
    // it has to go through the vue plugin's options.
    //
    // 'pre' puts this hook ahead of vite:vue's own configResolved, which
    // spreads the existing options and so keeps what is set here.
    configResolved(config) {
      const vue = config.plugins.find((p) => p.name === 'vite:vue');
      const api = vue?.api as VuePluginApi | undefined;
      if (!api?.options) {
        console.warn(
          '[fjs] @vitejs/plugin-vue not found in the Vite config — the fjs ' +
            'tags will compile as native DOM elements and nothing will be ' +
            "interactive. Add vue() to plugins: [fjs(), vue()].",
        );
        return;
      }
      const { template } = api.options;
      api.options = {
        ...api.options,
        template: {
          ...template,
          compilerOptions: { ...template?.compilerOptions, isNativeTag: webIsNativeTag },
        },
      };
    },
    resolveId(id) {
      if (id === 'fjs/pages') return VIRTUAL_PAGES;
      if (id === 'fjs/plugins') return VIRTUAL_PLUGINS;
      return null;
    },
    load(id) {
      if (VUE_ROUTE_BLOCK_RE.test(id)) return 'export default {}';
      if (id === VIRTUAL_PLUGINS) return pluginTableSource(pluginsFor(root, 'web'));
      if (id !== VIRTUAL_PAGES) return null;
      return routeTableSource(pagesFor(root, 'web'), 'web', false);
    },
    // `flex-grow: n` and `direction: horizontal` are fjs style keys, not the
    // CSS ones. injectStyle() rewrites them in the esbuild web build; here
    // the SFC <style> blocks go straight to vite:css instead, so without
    // this a page's flex-grow children keep their natural size and push the
    // tabBar off-screen. 'pre' runs this on the raw block, before scoping.
    transform(code, id) {
      return VUE_STYLE_BLOCK_RE.test(id) ? rewriteFjsCss(code) : null;
    },
    handleHotUpdate(ctx) {
      if (ctx.file.includes(`${path.sep}src${path.sep}pages${path.sep}`)) {
        writeRouteTypes(root);
        const mod = ctx.server.moduleGraph.getModuleById(VIRTUAL_PAGES);
        if (mod) ctx.server.moduleGraph.invalidateModule(mod);
      }
      // adding or removing a plugin file changes the generated list, which
      // no page imports directly — invalidate it by hand
      if (ctx.file.includes(`${path.sep}src${path.sep}plugins${path.sep}`)) {
        const mod = ctx.server.moduleGraph.getModuleById(VIRTUAL_PLUGINS);
        if (mod) ctx.server.moduleGraph.invalidateModule(mod);
      }
    },
  };
}
