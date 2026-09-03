// What a Vue re-render actually costs at the bridge. The question this
// answers: when a component re-renders but its output is unchanged, do ops
// still cross? Anything that does is pure waste — it lands as a jsonDecode
// and a widget rebuild on the Flutter side for no visible change.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createCommentVNode, h, defineComponent, ref, type VNode } from '@vue/runtime-core';
import { setOpSink } from '../src/host';
import { createApp, flutterRoot, registerStyles, styleEngine } from '../src/vue';
import { UiOp } from '../src/ui/ops';

(globalThis as { __fjsHost?: { uiOpsVersion: number } }).__fjsHost = {
  uiOpsVersion: 2,
};

const frames: Uint8Array[] = [];

beforeAll(() => {
  setOpSink((frame) => frames.push(frame));
});

afterEach(() => {
  frames.length = 0;
});

async function flush(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

/** Counts ops by opcode across every captured frame. */
function opCounts(): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const bytes of frames) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let i = 0;
    const u32 = () => {
      const v = view.getUint32(i, true);
      i += 4;
      return v;
    };
    while (i < bytes.length) {
      const op = bytes[i++];
      counts[op] = (counts[op] ?? 0) + 1;
      switch (op) {
        case UiOp.Create: {
          u32();
          const len = view.getUint16(i, true);
          i += 2 + len;
          break;
        }
        case UiOp.Remove:
          u32();
          break;
        case UiOp.Insert:
          i += 12;
          break;
        case UiOp.RemoveChild:
          i += 8;
          break;
        case UiOp.SetText:
        case UiOp.SetProps:
        case UiOp.DefineStyle: {
          u32();
          // NOT `i += u32()`: the compound assignment reads i before the
          // call advances it (same trap vue_styles.test.ts flags)
          const len = u32();
          i += len;
          break;
        }
        case UiOp.SetStyle:
          i += 12;
          break;
        case UiOp.ResetStyles:
          break;
        default:
          throw new Error(`unknown op ${op}`);
      }
    }
  }
  return counts;
}

const ROWS = 40;

describe('a re-render that changes nothing', () => {
  it('emits no ops for rows whose output is unchanged', async () => {
    const tick = ref(0);
    const App = defineComponent({
      setup() {
        return () =>
          h('view', null, [
            // only this text depends on `tick`
            h('text', null, String(tick.value)),
            ...Array.from({ length: ROWS }, (_, i): VNode =>
              h('view', { key: i, class: 'row' }, [h('text', null, `row ${i}`)])),
          ]);
      },
    });

    const app = createApp(App);
    app.mount(flutterRoot());
    await flush();
    frames.length = 0;

    tick.value = 1;
    await flush();

    const counts = opCounts();
    // one SetText for the counter, and nothing else
    expect(counts[UiOp.SetText] ?? 0).toBe(1);
    expect(counts[UiOp.SetProps] ?? 0).toBe(0);
    expect(counts[UiOp.SetStyle] ?? 0).toBe(0);
    app.unmount();
  });

  it('emits no ops for rows carrying an inline arrow handler', async () => {
    // `@tap="() => open(item)"` in a template compiles to a fresh closure on
    // every render, so Vue sees the prop as changed and calls patchProp for
    // every row. Vue's own DOM renderer absorbs this with an invoker; if this
    // renderer does not, every re-render writes one op per row for a handler
    // that did not actually change.
    const tick = ref(0);
    const App = defineComponent({
      setup() {
        const open = (i: number) => void i;
        return () =>
          h('view', null, [
            h('text', null, String(tick.value)),
            ...Array.from({ length: ROWS }, (_, i): VNode =>
              h('view', { key: i, class: 'row', onTap: () => open(i) }, [
                h('text', null, `row ${i}`),
              ])),
          ]);
      },
    });

    const app = createApp(App);
    app.mount(flutterRoot());
    await flush();
    frames.length = 0;

    tick.value = 1;
    await flush();

    const counts = opCounts();
    expect(counts[UiOp.SetText] ?? 0).toBe(1);
    expect(counts[UiOp.SetProps] ?? 0).toBe(0);
    app.unmount();
  });

  it('still tells the peer when a handler appears or goes away', async () => {
    // the marker is about presence, so presence changes must still cross
    const on = ref(false);
    const App = defineComponent({
      setup() {
        return () =>
          h('view', { onTap: on.value ? () => {} : undefined }, [h('text', null, 'x')]);
      },
    });

    const app = createApp(App);
    app.mount(flutterRoot());
    await flush();
    frames.length = 0;

    on.value = true;
    await flush();
    expect(opCounts()[UiOp.SetProps] ?? 0).toBe(1);
    frames.length = 0;

    // and again when it goes away
    on.value = false;
    await flush();
    expect(opCounts()[UiOp.SetProps] ?? 0).toBe(1);
    app.unmount();
  });

  it('a handler swapped in place still dispatches to the NEW closure', async () => {
    // the whole point of skipping the op is that the registry entry is
    // updated even though nothing crosses; if that broke, taps would run a
    // stale closure and no test above would notice
    const seen: string[] = [];
    const which = ref('a');
    let nodeId = 0;
    const App = defineComponent({
      setup() {
        return () => {
          const label = which.value;
          return h('view', {
            ref: (el: unknown) => {
              if (el && typeof (el as { id?: number }).id === 'number') {
                nodeId = (el as { id: number }).id;
              }
            },
            onTap: () => seen.push(label),
          });
        };
      },
    });

    const app = createApp(App);
    app.mount(flutterRoot());
    await flush();

    globalThis.__fjsDispatchEvent!(nodeId, 1, null);
    which.value = 'b';
    await flush();
    globalThis.__fjsDispatchEvent!(nodeId, 1, null);

    expect(seen).toEqual(['a', 'b']);
    app.unmount();
  });
});

describe('v-if anchors', () => {
  it('are invisible to the style engine, so a restyle skips them', async () => {
    // An anchor carries a fixed `display: none` and never changes. Routing it
    // through the style engine would make it permanently non-memoizable —
    // an inline style is what disables the compute cache — so every anchor
    // would pay a full cascade on every restyle. A list puts one in every
    // row, which is how they came to be ~22% of the elements on a page and
    // essentially all of its cache misses.
    const show = ref(false);
    const App = defineComponent({
      setup() {
        return () =>
          h('view', { class: 'page' },
            Array.from({ length: ROWS }, (_, i): VNode =>
              show.value
                ? h('view', { key: i, class: 'row' })
                : createCommentVNode('v-if', true)));
      },
    });

    // the engine is a module singleton, so only the delta means anything
    const before = styleEngine.stats.elements;
    const app = createApp(App);
    app.mount(flutterRoot());
    await flush();
    const added = styleEngine.stats.elements - before;

    // ROWS anchors were created; the page root is the only tracked element
    expect(added).toBeLessThan(5);

    styleEngine.resetStats();
    registerStyles(null, '.page { color: #333; }');
    await flush();
    // a new stylesheet dirties every tracked element; anchors are not among
    // them, so the pass cannot have visited one per row
    expect(styleEngine.stats.recompute).toBeLessThan(before + 5);
    app.unmount();
  });

  it('unmounting a subtree forgets every element under it', async () => {
    // Vue removes only the root of a subtree; the descendants go with it
    // implicitly and it never mentions them again. If the renderer forgets
    // only the node it was told about, every element of every page the user
    // navigates away from stays registered, and each later restyle walks
    // them all — invisible except as "the app got slower the longer you use
    // it".
    const ROWS = 30;
    const show = ref(true);
    const App = defineComponent({
      setup() {
        return () =>
          h('view', { class: 'page' },
            show.value
              ? [h('view', { class: 'list' },
                  Array.from({ length: ROWS }, (_, i): VNode =>
                    h('view', { key: i, class: 'row' }, [h('text', null, 'x')])))]
              : []);
      },
    });

    const before = styleEngine.stats.elements;
    const app = createApp(App);
    app.mount(flutterRoot());
    await flush();
    // page + list + ROWS rows, each with a text child
    expect(styleEngine.stats.elements - before).toBeGreaterThan(ROWS * 2);

    show.value = false;
    await flush();
    // only the page root is left of what this test added
    expect(styleEngine.stats.elements - before).toBeLessThan(3);
    app.unmount();
  });
});

