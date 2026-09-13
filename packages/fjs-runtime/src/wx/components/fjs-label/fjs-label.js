// fjs <label> on wx: tapping the row forwards to a control — the one named by
// `for` (an id in the same template), else the first checkbox / radio inside
// it (docs/ui-api.md). The controls catch their own taps, so a tap on the
// control itself does not toggle twice.
const CONTROLS = ['../fjs-checkbox/fjs-checkbox', '../fjs-radio/fjs-radio'];
Component({
  properties: {
    // flex layout copied from the page's classes on this host (compiler)
    layout: { type: String, value: '' },
    for: { type: String, value: '' },
  },
  relations: {
    '../fjs-checkbox/fjs-checkbox': { type: 'descendant' },
    '../fjs-radio/fjs-radio': { type: 'descendant' },
  },
  methods: {
    onTap() {
      let target = null;
      if (this.data.for) {
        const owner = this.selectOwnerComponent && this.selectOwnerComponent();
        target = owner ? owner.selectComponent('#' + this.data.for) : null;
      }
      if (!target) {
        for (const rel of CONTROLS) {
          target = this.getRelationNodes(rel)[0];
          if (target) break;
        }
      }
      if (target && typeof target.toggle === 'function') target.toggle();
    },
  },
});
