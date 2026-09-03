// What Vue itself costs on a theme switch, separately from the style engine.
//
// The style benches drive StyleEngine directly, so they say nothing about the
// framework sitting on top. The question this answers: when a theme changes,
// does Vue re-render the whole list — and if so, what is that worth?
//
// A theme reaches a row through inherited custom properties, not through
// props, so nothing about a row's vnode output depends on the theme. If the
// list lives in a component that does not read the theme, Vue should skip it
// entirely.
import { createCommentVNode, defineComponent, h, ref, type VNode } from 'vue';
// createApp comes from the fjs renderer, not from vue: runtime-core has no
// createApp of its own, it is the renderer that supplies one
import { createApp, flutterRoot, registerStyles } from 'fjs/vue';
import { flush, nowMs, setOpSink } from 'fjs';

const SHEET = `
.page { background-color: var(--bg); flex-grow: 1; }
.row { background-color: var(--card); border-radius: 8px; padding: 12px 16px;
       margin: 4px 12px; flex-direction: row; align-items: center; gap: 8px; }
.title { color: var(--title); font-size: 16px; flex-grow: 1; }
.meta { color: var(--muted); font-size: 12px; }
.badge { color: var(--card); background-color: var(--title); border-radius: 4px;
         padding: 2px 6px; font-size: 10px; align-items: center; }
`;

const LIGHT = {
  '--bg': '#f4f5f7', '--card': '#ffffff', '--title': '#1a1a1a', '--muted': '#999999',
};
const DARK = {
  '--bg': '#101114', '--card': '#1c1d22', '--title': '#f2f2f7', '--muted': '#8e8e93',
};

const ROWS = 1000;
const items = Array.from({ length: ROWS }, (_, i) => ({
  id: i,
  title: `row ${i}`,
  meta: `#${i}`,
}));

function rowNodes(): VNode[] {
  return items.map((item) =>
    h('view', { key: item.id, class: 'row', onTap: () => item.id }, [
      h('text', { class: 'title' }, item.title),
      h('text', { class: 'meta' }, item.meta),
      // what `v-if` compiles to when the condition is false: a comment
      // anchor. A real list is full of these — one per falsy v-if per row —
      // and they are invisible, so it is easy to forget they are nodes.
      item.id % 7 === 0
        ? h('view', { class: 'badge' }, [h('text', null, 'new')])
        : createCommentVNode('v-if', true),
    ]));
}

/** The list as its own component, with no reactive dependency on the theme. */
const IsolatedList = defineComponent({
  name: 'IsolatedList',
  setup: () => () => h('view', null, rowNodes()),
});

/** `inline: true` renders the rows inside the component that owns the theme
 * ref — the shape you get by just writing the page as one file. */
function makeApp(inline: boolean) {
  const dark = ref(false);
  const App = defineComponent({
    setup() {
      return () => {
        return h(
          'view',
          { class: 'page', style: dark.value ? DARK : LIGHT },
          inline ? rowNodes() : [h(IsolatedList)],
        );
      };
    },
  });
  const app = createApp(App);
  app.mount(flutterRoot());
  return { app, dark };
}

const drain = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};

export async function runVueBenches(): Promise<void> {
  let bytes = 0;
  setOpSink((frame) => {
    bytes += frame.length;
  });
  registerStyles(null, SHEET);

  // Both variants are mounted up front and toggled ALTERNATELY. Measuring one
  // fully and then the other hands the second a JIT-warmed path — running
  // them in sequence is how the same measurement on a device reported the
  // opposite ordering. Toggling one app's ref only re-renders that app.
  const inline = makeApp(true);
  const isolated = makeApp(false);
  await drain();

  const times = { inline: [] as number[], isolated: [] as number[] };
  const frameBytes = { inline: 0, isolated: 0 };

  for (let i = 0; i <= 7; i++) {
    for (const [name, app] of [
      ['inline', inline],
      ['isolated', isolated],
    ] as const) {
      bytes = 0;
      const t0 = nowMs();
      app.dark.value = !app.dark.value;
      await drain();
      const dt = nowMs() - t0;
      if (i === 0) continue; // warm-up round
      times[name].push(dt);
      frameBytes[name] = bytes;
    }
  }

  for (const name of ['inline', 'isolated'] as const) {
    const t = times[name].sort((a, b) => a - b);
    console.log('[bench]', JSON.stringify({
      bench: name === 'inline'
        ? 'vue-theme-switch-inline'
        : 'vue-theme-switch-isolated-list',
      ops: ROWS * 4,
      minMs: +t[0].toFixed(2),
      medMs: +t[t.length >> 1].toFixed(2),
      maxMs: +t[t.length - 1].toFixed(2),
      frameBytes: frameBytes[name],
    }));
  }

  inline.app.unmount();
  isolated.app.unmount();
  await drain();
}
