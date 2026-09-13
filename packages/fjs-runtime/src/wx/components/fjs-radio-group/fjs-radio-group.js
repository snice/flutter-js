// fjs <radio-group> on wx: mutual exclusion over its fjs-radio descendants;
// change carries the selected radio's name (docs/ui-api.md).
Component({
  properties: {
    // flex layout copied from the page's classes on this host (compiler)
    layout: { type: String, value: '' },
  },
  relations: {
    '../fjs-radio/fjs-radio': { type: 'descendant' },
  },
  methods: {
    childSelected(target) {
      for (const r of this.getRelationNodes('../fjs-radio/fjs-radio')) {
        if (r !== target) r.setOn(false);
      }
      this.triggerEvent('change', { value: target.data.name });
    },
  },
});
