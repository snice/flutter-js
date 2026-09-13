// icon-mind on WeChat mini programs (skyline). Skyline has no inline SVG, so
// the same shapes the web stand-in renders as <svg> (components/
// IconMindWeb.vue) are serialized into an SVG data URI and drawn by <image>.
// Geometry, stroke per weight and the two duotone rules match that file.
//
// The shapes come from this module's prepare output: `fjs build --mp` copies
// the generated icons.json next to this component as ../data/icons.json.js.
//
// Color: on the web the SVG strokes with currentColor. An image does not
// inherit `color`, and skyline cannot read a computed style back, so the
// compiler passes the color the icon inherits from the page's classes as
// `fjs-color` (a literal or a `var(--x)`), and the runtime's recorded theme
// variables resolve it (fjs-runtime/src/wx/style.ts). An explicit `color`
// wins over both.
const icons = require('../data/icons.json.js');

// index.ts STROKE — kept in sync by hand: this file is plain JS copied
// into the mini program, it cannot import the TypeScript entry
const STROKE = { thin: 1.25, regular: 1.75, bold: 2.5 };
const FALLBACK_COLOR = '#333333';

function esc(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function svgFor(shapes, color, stroke, duotone) {
  const c = esc(color);
  let body = '';
  if (duotone) {
    for (const [d, closed] of shapes) {
      body += closed
        ? `<path d="${esc(d)}" fill="${c}" stroke="none" opacity="0.2"/>`
        : `<path d="${esc(d)}" stroke-width="${stroke + 3}" opacity="0.2"/>`;
    }
  }
  for (const [d] of shapes) body += `<path d="${esc(d)}"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" ` +
    `stroke="${c}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
  );
}

Component({
  properties: {
    name: { type: String, value: '' },
    size: { type: null, value: 24 },
    color: { type: String, value: '' },
    variant: { type: String, value: 'outline' },
    weight: { type: String, value: 'regular' },
    // compiler-provided inherited color (see above)
    fjsColor: { type: String, value: '' },
  },
  data: { src: '', px: 24 },
  observers: {
    'name, size, color, variant, weight, fjsColor'() {
      this.paint();
    },
  },
  lifetimes: {
    attached() {
      const wxrt = globalThis.__fjsWx;
      // a theme switch changes the variables the color may come from
      this.__offVars = wxrt && wxrt.onCssVarsChange ? wxrt.onCssVarsChange(() => this.paint()) : null;
      this.paint();
    },
    detached() {
      if (this.__offVars) this.__offVars();
    },
  },
  methods: {
    paint() {
      const { name, size, color, variant, weight, fjsColor } = this.data;
      const px = Number(size) || 24;
      const shapes = name ? icons[name] : null;
      if (name && !shapes) console.warn(`[iconmind] no icon named "${name}"`);
      if (!shapes) {
        if (this.data.src !== '' || this.data.px !== px) this.setData({ src: '', px });
        return;
      }
      const wxrt = globalThis.__fjsWx;
      const resolve = (v) => (v && wxrt && wxrt.resolveCssColor ? wxrt.resolveCssColor(v) : v);
      const ink = resolve(color) || resolve(fjsColor) || FALLBACK_COLOR;
      const svg = svgFor(shapes, ink, STROKE[weight] || STROKE.regular, variant === 'duotone');
      const src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      if (src !== this.data.src || px !== this.data.px) this.setData({ src, px });
    },
  },
});
