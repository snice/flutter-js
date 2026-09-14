// fjs <rich-text> on wx. Parsing, the whitelist, default styles, list
// numbers and the table fallback are the JS pipeline the other two ends run
// (fjs-runtime/src/rich-text, via buildWxRichText in wx/rich-text.ts —
// published on globalThis.__fjsWx because this plain Component() file cannot
// import the TypeScript runtime). This component only feeds the result to
// fjs-rich-node. Not the native rich-text: see wx/rich-text.ts.
//
// The host is a real node (not a virtual host) so the page's bindtap and
// classes land on it; inner nodes carry no events, like the other ends.
const warned = new Set();
function warnOnce(key, message) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[fjs] rich-text: ${message}`);
}

Component({
  properties: {
    nodes: { type: null, value: [] },
    space: { type: String, value: '' },
    // the page's scoped-style class, added by the compiler
    scope: { type: String, value: '' },
    userSelect: { type: null, value: false },
    mode: { type: String, value: 'default' },
  },
  data: { tree: [] },
  observers: {
    'nodes, space, scope'() {
      this.build();
    },
    userSelect(v) {
      if (v === true || v === 'true' || v === '') warnOnce('user-select', 'user-select is not supported; text stays unselectable');
    },
    mode(v) {
      if (v && v !== 'default') warnOnce(`mode:${v}`, `mode="${v}" is Skyline-only and not supported; rendered as default`);
    },
  },
  methods: {
    build() {
      const wx = globalThis.__fjsWx;
      if (!wx || typeof wx.buildWxRichText !== 'function') {
        console.error('[fjs] rich-text: the fjs runtime is not loaded (globalThis.__fjsWx.buildWxRichText missing)');
        return;
      }
      const { nodes, space, scope } = this.data;
      this.setData({ tree: wx.buildWxRichText(nodes, space, scope) });
    },
  },
});
