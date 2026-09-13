// `fjs dev --mp`: watch the project and re-emit the mini-program output on
// every source change. No HTTP server — WeChat DevTools watches dist/mp
// itself and recompiles (compileHotReLoad, written by mpBuild), so the dev
// loop is: save in the editor -> fjs re-emits -> DevTools applies.
import fs from 'node:fs';
import path from 'node:path';
import { mpBuild, type MpOptions } from './build.js';
import { error } from '../terminal/colors.js';

export interface MpDevOptions {
  root: string;
  outDir: string;
}

const DEBOUNCE_MS = 120;

export async function mpDev(opts: MpOptions): Promise<void> {
  const { root } = opts;
  const outRootAbs = path.resolve(root, opts.outDir, 'mp');
  const srcDir = path.join(root, 'src');

  await mpBuild(opts);

  let timer: NodeJS.Timeout | null = null;
  let building = false;
  let pending = false;
  const rebuild = (why: string): void => {
    if (building) {
      pending = true;
      return;
    }
    building = true;
    const t0 = Date.now();
    void mpBuild(opts)
      .then(() => {
        console.log(`fjs dev --mp: rebuilt (${why}) in ${Date.now() - t0}ms`);
      })
      .catch((err) => {
        error(
          `fjs dev --mp: rebuild failed: ${err instanceof Error ? err.message : err}`,
        );
      })
      .finally(() => {
        building = false;
        if (pending) {
          pending = false;
          rebuild('pending changes');
        }
      });
  };
  const schedule = (why: string): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      rebuild(why);
    }, DEBOUNCE_MS);
  };

  const watchers: fs.FSWatcher[] = [];
  const onEvent = (_event: string, filename: string | Buffer | null): void => {
    const rel = filename ? path.basename(String(filename)) : '';
    // our own output + editor droppings
    if (!rel || rel.startsWith('.')) return;
    schedule(rel);
  };
  try {
    watchers.push(fs.watch(srcDir, { recursive: true }, onEvent));
  } catch {
    // recursive watch unsupported (Linux) — fall back to per-directory
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          watchers.push(fs.watch(full, onEvent));
        }
      }
      watchers.push(fs.watch(dir, onEvent));
    };
    walk(srcDir);
  }
  // app-level inputs live outside src/
  for (const file of ['package.json', 'app.config.ts', 'app.config.js', 'app.config.json']) {
    const abs = path.join(root, file);
    if (fs.existsSync(abs)) watchers.push(fs.watch(abs, onEvent));
  }

  console.log(
    `fjs dev --mp: watching src/ -> ${path.relative(root, outRootAbs)} (${watchers.length} watchers)`,
  );
  console.log('WeChat DevTools picks up changes on its own — keep the project open');
  process.on('SIGINT', () => {
    for (const w of watchers) w.close();
    process.exit(0);
  });
}

