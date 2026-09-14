// Worker scripts: `src/workers/<rel>.{ts,js}` → `/workers/<rel>.js` (specs/049).
//
// `new Worker(path)` takes a file path on every target because the mini
// program leaves no other choice: `wx.createWorker` only runs a real file
// under the app.json "workers" directory, and a mini program cannot eval a
// code string. So the three ends share one convention — a worker is a file
// in src/workers, addressed by the root path `wx.createWorker` would take —
// and every build emits the same `workers/<rel>.js` next to its output:
//
//   Flutter  <outDir>/workers → assets/fjs/public/workers (fetched by path)
//   web      <webOut>/workers (vite dev compiles on request)
//   mp       miniprogram/workers, wrapped for wx's `worker` global
//
// A worker is bundled on its own (iife): it may import the project's local
// modules, and what comes out is self-contained — a worker has no module
// loader and no fjs runtime to import from.
import fs from 'node:fs';
import path from 'node:path';
import esbuild from 'esbuild';
import { srcAliasPlugin } from '../bundler/vue-plugin.js';

export const WORKERS_DIR = 'workers';
const SOURCE_EXT = /\.(ts|js)$/;

export interface WorkerEntry {
  /** root path the page passes to `new Worker` ('/workers/a/b.js') */
  url: string;
  /** absolute source file */
  file: string;
}

/** Every worker source under src/workers. `a.ts` and `a.js` side by side
 * would claim the same URL — an error, not a silent pick. Declaration files
 * are types, not workers. */
export function scanWorkers(root: string): WorkerEntry[] {
  const dir = path.join(root, 'src', WORKERS_DIR);
  if (!fs.existsSync(dir)) return [];
  const out = new Map<string, WorkerEntry>();
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!SOURCE_EXT.test(entry.name) || entry.name.endsWith('.d.ts')) continue;
      const rel = path.relative(dir, abs).split(path.sep).join('/').replace(SOURCE_EXT, '.js');
      const url = `/${WORKERS_DIR}/${rel}`;
      const clash = out.get(url);
      if (clash) {
        throw new Error(
          `worker ${url} has two sources: ${path.relative(root, clash.file)} and ${path.relative(root, abs)}`,
        );
      }
      out.set(url, { url, file: abs });
    }
  };
  walk(dir);
  return [...out.values()].sort((a, b) => a.url.localeCompare(b.url));
}

/** The source file behind a `/workers/…js` URL, or null. */
export function workerFileForUrl(root: string, url: string): string | null {
  return scanWorkers(root).find((w) => w.url === url)?.file ?? null;
}

/** One worker bundled into a self-contained script. */
export async function bundleWorker(root: string, file: string, minify = false): Promise<string> {
  const result = await esbuild.build({
    entryPoints: [file],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2020',
    platform: 'neutral',
    // neutral leaves mainFields empty; a worker importing a package still
    // wants the usual resolution
    mainFields: ['module', 'main'],
    minify,
    plugins: [srcAliasPlugin(root)],
    logLevel: 'silent',
    legalComments: 'none',
  });
  return result.outputFiles[0].text;
}

/** Bundles every worker into `<destDir>/workers/<rel>.js`, passing each
 * script through `wrap` first (the mini program's shim). Returns the URLs. */
export async function writeWorkers(
  root: string,
  destDir: string,
  options: { minify?: boolean; wrap?: (code: string, entry: WorkerEntry) => string } = {},
): Promise<string[]> {
  const workers = scanWorkers(root);
  const outDir = path.join(destDir, WORKERS_DIR);
  fs.rmSync(outDir, { recursive: true, force: true });
  for (const worker of workers) {
    const code = await bundleWorker(root, worker.file, options.minify);
    const dest = path.join(destDir, worker.url.slice(1));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, options.wrap ? options.wrap(code, worker) : code);
  }
  return workers.map((w) => w.url);
}

/** The mini-program worker file around a bundled script. wx exposes a
 * `worker` global (worker.onMessage / worker.postMessage with objects) where
 * the other ends have `onmessage` / `postMessage(string)`. The bundle is
 * wrapped in a function declaring its own `onmessage`: the bundle's
 * `onmessage = …` then resolves to that local (lexical scope) — an
 * assignment to an undeclared global would throw in the strict-mode code an
 * ES module compiles to, and whether wx's worker context even has such a
 * global is not something to depend on. Strings travel as `{ d }`, a thrown
 * error as `{ e }` (reported to the page's onerror). */
export function wrapWxWorker(code: string, entry: WorkerEntry, root?: string): string {
  const from = root ? path.relative(root, entry.file).split(path.sep).join('/') : entry.url;
  return `// generated by fjs build --mp from ${from}
(function () {
  var onmessage = null;
  function postMessage(message) {
    worker.postMessage({ d: String(message) });
  }
  function __fjsFail(err) {
    worker.postMessage({ e: String((err && err.message) || err) });
  }
  worker.onMessage(function (msg) {
    if (typeof onmessage !== 'function') return;
    try {
      onmessage({ data: msg && msg.d });
    } catch (err) {
      __fjsFail(err);
    }
  });
  try {
${code}
  } catch (err) {
    __fjsFail(err);
  }
})();
`;
}
