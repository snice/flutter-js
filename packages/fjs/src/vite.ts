// Vite adapter for fjs apps. Runtime/native builds still go through
// `fjs build`; this plugin makes the same Vue/pages app run as a normal
// browser app during Vite dev/build.
import { pagesFor, routeTableSource } from './pages.js';
import { runtimeDir } from './vue-plugin.js';
import path from 'node:path';

const VIRTUAL_PAGES = '\0fjs-pages';
const VUE_ROUTE_BLOCK_RE = /\.vue\?vue&type=route(?:&|$)/;

interface ViteConfig {
  root?: string;
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
  resolveId(id: string): string | null;
  load(id: string): string | null;
  handleHotUpdate(ctx: HotUpdateContext): void;
}

export function fjs(): VitePlugin {
  let root = process.cwd();
  return {
    name: 'fjs-vite',
    enforce: 'pre',
    config(config) {
      root = config.root ? path.resolve(config.root) : process.cwd();
      const runtime = runtimeDir();
      return {
        resolve: {
          alias: [
            { find: /^fjs\/app$/, replacement: path.join(runtime, 'src', 'app', 'web.ts') },
            { find: /^fjs\/router$/, replacement: path.join(runtime, 'src', 'router', 'web.ts') },
            { find: /^fjs\/web$/, replacement: path.join(runtime, 'src', 'web', 'index.ts') },
            { find: /^fjs\/vue$/, replacement: path.join(runtime, 'src', 'vue', 'index.ts') },
            { find: /^fjs$/, replacement: path.join(runtime, 'src', 'index.ts') },
          ],
        },
      };
    },
    resolveId(id) {
      return id === 'fjs/pages' ? VIRTUAL_PAGES : null;
    },
    load(id) {
      if (VUE_ROUTE_BLOCK_RE.test(id)) return 'export default {}';
      if (id !== VIRTUAL_PAGES) return null;
      return routeTableSource(pagesFor(root, 'web'), 'web', false);
    },
    handleHotUpdate(ctx) {
      if (ctx.file.includes(`${path.sep}src${path.sep}pages${path.sep}`)) {
        const mod = ctx.server.moduleGraph.getModuleById(VIRTUAL_PAGES);
        if (mod) ctx.server.moduleGraph.invalidateModule(mod);
      }
    },
  };
}
