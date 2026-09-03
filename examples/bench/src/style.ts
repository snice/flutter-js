// Style-engine benchmarks: cascade + compute + op encoding, isolated from
// any framework. main.ts's UI benches use bare h() with inline styles and
// never touch StyleEngine, so they say nothing about the path a real Vue
// app — or a theme switch — actually walks.
//
// Methodology matters here more than usual. A first attempt that timed one
// pass per configuration reordered its own results by 2x: under QuickJS the
// cost of a 4000-node restyle is dominated by allocation, so whichever pass
// happens to trigger a collection wears the whole bill. So: build the world
// once, warm up, repeat, and report the MINIMUM. The minimum is the run that
// did not collect, which is the number that describes the code rather than
// the heap it happened to land on. Spread (min vs max) is printed too — when
// it is large, GC is the story and no amount of staring at the mean helps.
import {
  create,
  createRoot,
  insert,
  setProps,
  setStyle,
  setText,
  flush,
  gc,
  nowMs,
  setOpSink,
  StyleEngine,
  type Element,
} from 'fjs';

// ---- frame accounting -------------------------------------------------------

let frameBytes = 0;
let frameCount = 0;
/** Frames are counted and dropped, not forwarded: fjsrun's op sink printf's
 * every op it decodes, which costs more than everything being measured. The
 * native commit is measured on a device, not here. */
setOpSink((frame) => {
  frameBytes += frame.length;
  frameCount++;
});

/** Lets StyleEngine's microtask recompute run, then flushes the ops it
 * queued. Two hops: one for the engine's flush, one for the op flush. */
async function drain(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  flush();
}

interface Case {
  /** Runs once before each timed pass; not measured. */
  setup?: () => void | Promise<void>;
  /** Collect before each timed pass, so a collection cannot land inside the
   * window. The gap between this on and off is what GC is costing. */
  collectFirst?: boolean;
  /** The measured work. Must leave the world reusable by the next pass. */
  run: () => void | Promise<void>;
  ops: number;
}

async function bench(name: string, c: Case, passes = 7): Promise<void> {
  const times: number[] = [];
  let bytes = 0;
  let frames = 0;
  // one untimed warm-up pass: interns chain keys, fills the compute cache,
  // and grows the buffers, so the timed passes measure steady state
  for (let i = 0; i <= passes; i++) {
    if (c.setup) await c.setup();
    await drain();
    if (c.collectFirst) gc();
    frameBytes = 0;
    frameCount = 0;
    const t0 = nowMs();
    await c.run();
    await drain();
    const dt = nowMs() - t0;
    if (i === 0) continue; // warm-up
    times.push(dt);
    bytes = frameBytes;
    frames = frameCount;
  }
  times.sort((a, b) => a - b);
  const min = times[0];
  console.log('[bench]', JSON.stringify({
    bench: name,
    ops: c.ops,
    minMs: +min.toFixed(2),
    medMs: +times[times.length >> 1].toFixed(2),
    maxMs: +times[times.length - 1].toFixed(2),
    opsPerMs: +(c.ops / Math.max(min, 0.01)).toFixed(1),
    frames,
    frameBytes: bytes,
    bytesPerOp: +(bytes / Math.max(c.ops, 1)).toFixed(1),
  }));
}

// ---- a renderer-shaped harness ----------------------------------------------
// Mirrors what vue/renderer.ts does around StyleEngine: shadow parent/child
// maps, an element registry, and an applyStyle that goes through the same
// setStyle fast path (shared serialization keyed on style object identity).

// A stylesheet shaped like a real themed page: tokens on the root, every
// visual property behind var(), and a .dark override that only redefines
// the tokens.
const SHEET = `
.page {
  --bg: #f4f5f7;
  --card: #ffffff;
  --border: #e5e5e5;
  --title: #1a1a1a;
  --text: #333333;
  --muted: #999999;
  background-color: var(--bg);
  flex-grow: 1;
}
.page.dark {
  --bg: #101114;
  --card: #1c1d22;
  --border: #2c2d33;
  --title: #f2f2f2;
  --text: #d0d0d0;
  --muted: #7a7a7a;
}
.row {
  background-color: var(--card);
  border-color: var(--border);
  border-radius: 8px;
  padding: 12px 16px;
  margin: 4px 12px;
  flex-direction: row;
  align-items: center;
  gap: 8px;
}
.row:active { background-color: var(--border); }
.title { color: var(--title); font-size: 16px; font-weight: 500; flex-grow: 1; }
.meta { color: var(--muted); font-size: 12px; }
.badge {
  color: var(--card);
  background-color: var(--title);
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 10px;
}
`;

interface World {
  engine: StyleEngine;
  page: Element;
  rows: Element[];
  firstRow: number;
  nodes: number;
}

/** `bridge: false` swaps applyStyle for a counter, so the same cascade runs
 * with the serialization and op encoding removed. The difference between the
 * two is what the bridge costs; the rest is the engine itself. */
function buildWorld(rows: number, bridge = true): World {
  const parentOf = new Map<number, number | null>();
  const childrenOf = new Map<number, number[]>();
  const elements = new Map<number, Element>();
  /** Elements the native side is holding an `:active` style for — the same
   * bookkeeping vue/renderer.ts does, so `.row:active` exercises the real
   * (memo-bypassing) serialization path. */
  const hadActiveStyle = new Set<number>();

  const engine = new StyleEngine(parentOf, childrenOf, (id, style, activeStyle) => {
    const el = elements.get(id);
    if (!el) return;
    if (!bridge) return;
    if (activeStyle === null && !hadActiveStyle.has(id)) return setStyle(el, style);
    if (activeStyle) hadActiveStyle.add(id);
    else hadActiveStyle.delete(id);
    setStyle(el, style, activeStyle);
  });
  engine.register(null, SHEET);

  const mount = (tag: string, parent: Element | null, cls?: string): Element => {
    const el = create(tag);
    elements.set(el.id, el);
    engine.ensure(el.id, tag);
    if (cls) engine.setClasses(el.id, cls);
    if (parent) {
      insert(parent, el);
      parentOf.set(el.id, parent.id);
      const list = childrenOf.get(parent.id) ?? [];
      list.push(el.id);
      childrenOf.set(parent.id, list);
      engine.recomputeSubtree(el.id);
    } else {
      parentOf.set(el.id, null);
    }
    return el;
  };

  const root = createRoot('view');
  elements.set(root.id, root);
  engine.ensure(root.id, 'view');
  parentOf.set(root.id, null);
  const page = mount('view', root, 'page');
  const rowEls: Element[] = [];
  for (let i = 0; i < rows; i++) {
    const row = mount('view', page, 'row');
    rowEls.push(row);
    setText(mount('text', row, 'title'), 'row ' + i);
    setText(mount('text', row, 'meta'), '#' + i);
    setText(mount('text', row, 'badge'), 'new');
  }
  return {
    engine,
    page,
    rows: rowEls,
    firstRow: rowEls[0]?.id ?? 0,
    nodes: rows * 4 + 2,
  };
}

const DARK = {
  '--bg': '#101114',
  '--card': '#1c1d22',
  '--border': '#2c2d33',
  '--title': '#f2f2f2',
  '--text': '#d0d0d0',
  '--muted': '#7a7a7a',
};

/** Synthesizes the rule volume a real app carries. hello-fjs preloads 24
 * page chunks, each registering its own `<style scoped>` blocks, so the
 * engine's rule list is not the handful this file's sheet declares. */
function noiseSheet(rules: number): string {
  const out: string[] = [];
  for (let i = 0; i < rules; i++) {
    out.push(`.noise-${i} { color: #${(i % 9) + 1}00000; font-size: ${10 + (i % 8)}px; }`);
    out.push(`.noise-${i} .child-${i} { margin: ${i % 5}px; }`);
  }
  return out.join('\n');
}

export async function runStyleBenches(): Promise<void> {
  const ROWS = 1000;

  // Mount is measured on its own world each pass (it is the one case that
  // cannot be repeated in place), which is why its spread is the widest.
  await bench(`style-mount-${ROWS}-rows`, {
    run: () => { buildWorld(ROWS); },
    ops: ROWS * 4,
  }, 3);

  const w = buildWorld(ROWS);
  await drain();

  // The way a theme switch is usually written: flip a class on the root.
  // This changes the root's selfSig -> chainId, so every descendant's
  // chainKey changes too and the whole matchCache turns over.
  let dark = false;
  await bench('theme-switch-class', {
    run: () => {
      dark = !dark;
      w.engine.setClasses(w.page.id, dark ? 'page dark' : 'page');
    },
    ops: w.nodes,
  });

  // The same visual result driven by custom properties: chainKey is
  // untouched, so matchRules stays warm and only the compute cascade re-runs.
  w.engine.setClasses(w.page.id, 'page');
  await drain();
  let on = false;
  await bench('theme-switch-vars', {
    run: () => {
      on = !on;
      w.engine.setInlineCustomProps(w.page.id, on ? DARK : {
        '--bg': null, '--card': null, '--border': null,
        '--title': null, '--text': null, '--muted': null,
      } as Record<string, unknown>);
    },
    ops: w.nodes,
  });

  // The same switch with a collection taken out of the timed window. On a
  // device the two differ by more than everything else in this file put
  // together; see docs/performance.md.
  const wg = buildWorld(ROWS);
  await drain();
  let gdark = false;
  await bench('theme-switch-vars-gc-first', {
    collectFirst: true,
    run: () => {
      gdark = !gdark;
      wg.engine.setInlineCustomProps(wg.page.id, gdark ? DARK : {
        '--bg': null, '--card': null, '--border': null,
        '--title': null, '--text': null, '--muted': null,
      } as Record<string, unknown>);
    },
    ops: wg.nodes,
  });

  // Same switch with the bridge removed: cascade, inheritance and var()
  // resolution only. full - cascadeOnly = JSON.stringify + utf8 + op writer.
  const wc = buildWorld(ROWS, false);
  await drain();
  let cdark = false;
  await bench('theme-switch-cascade-only', {
    run: () => {
      cdark = !cdark;
      wc.engine.setClasses(wc.page.id, cdark ? 'page dark' : 'page');
    },
    ops: wc.nodes,
  });

  // What a framework re-render costs at the bridge when every row carries a
  // tap handler. A template's `@tap="() => open(item)"` is a fresh closure on
  // every render, so the renderer re-assigns the handler for every row. That
  // must produce no ops: the native side only ever learns that a handler
  // EXISTS, and it already knows.
  const handlers = buildWorld(ROWS);
  for (const row of handlers.rows) setProps(row, { onTap: () => {} });
  await drain();
  let n = 0;
  await bench('rerender-handlers-only', {
    run: () => {
      n++;
      for (const row of handlers.rows) setProps(row, { onTap: () => n });
    },
    ops: ROWS,
  });

  // Does carrying a real app's worth of CSS change the per-node cost of a
  // theme switch? It should not — matchCache is keyed on the tree signature,
  // which a custom-property change does not touch — and if it does, the
  // cache is not doing its job.
  for (const rules of [200]) {
    const noisy = buildWorld(ROWS);
    noisy.engine.register(null, noiseSheet(rules));
    await drain();
    let on2 = false;
    await bench(`theme-switch-vars-with-${rules * 2}-rules`, {
      run: () => {
        on2 = !on2;
        noisy.engine.setInlineCustomProps(noisy.page.id, on2 ? DARK : {
          '--bg': null, '--card': null, '--border': null,
          '--title': null, '--text': null, '--muted': null,
        } as Record<string, unknown>);
      },
      ops: noisy.nodes,
    });
  }

  // Regression sentinel for per-node work: one leaf changes class. Anything
  // that makes a whole-tree walk out of a single-node change shows up here.
  let alt = false;
  await bench('style-single-node', {
    run: () => {
      alt = !alt;
      w.engine.setClasses(w.firstRow, alt ? 'row' : 'row title');
    },
    ops: 1,
  });
}
