// icon-mind on WeChat mini programs (skyline). The icon shapes live in the
// Flutter host and as inline SVG on the web; skyline has neither, so this
// first version renders a layout-stable empty box (TabBar/NavBar degrade to
// labels-only). A real painter would come from the app's generated icon
// data (prepare.mjs) — canvas 2d or an embedded font — in a later spec.
Component({
  options: {
    virtualHost: true,
  },
  properties: {
    name: { type: String, value: '' },
    size: { type: null, value: null },
    color: { type: String, value: '' },
    variant: { type: String, value: '' },
    weight: { type: String, value: 'regular' },
  },
});
