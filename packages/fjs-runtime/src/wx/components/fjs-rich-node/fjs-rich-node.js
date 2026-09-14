// One level of fjs <rich-text> content (wx/rich-text.ts describes the data).
// Recursion happens only where a block holds blocks — a paragraph's runs, an
// image or a divider are drawn in this template — so a long article costs a
// component instance per nesting level of lists / tables, not per element.
// A virtual host: the instance itself is no layout box.
Component({
  options: { virtualHost: true },
  properties: {
    list: { type: Array, value: [] },
  },
  methods: {
    // <img> without width/height: natural size, no wider than the container
    // (rich-text/layout.ts). wx images default to 320x240, so the size is
    // set once the picture reports it.
    onImageLoad(e) {
      const { i, j } = e.currentTarget.dataset;
      const w = Number(e.detail && e.detail.width) || 0;
      if (!w) return;
      const path = j === undefined || j === '' ? `list[${i}]` : `list[${i}].n[${j}]`;
      const node = j === undefined || j === '' ? this.data.list[i] : this.data.list[i].n[j];
      if (!node || !node.a) return;
      this.setData({
        [`${path}.s`]: `width: ${w}px; max-width: 100%; ${node.s || ''}`,
        [`${path}.mode`]: 'widthFix',
        [`${path}.a`]: false,
      });
    },
  },
});
