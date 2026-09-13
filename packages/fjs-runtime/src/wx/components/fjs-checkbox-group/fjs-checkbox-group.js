// fjs <checkbox-group> on wx: change carries the checked names as a JSON
// array string (docs/ui-api.md), in the order the checkboxes were linked —
// document order for a static list.
Component({
  properties: {
    // flex layout copied from the page's classes on this host (compiler)
    layout: { type: String, value: '' },
  },
  relations: {
    '../fjs-checkbox/fjs-checkbox': { type: 'descendant' },
  },
  methods: {
    childChanged() {
      const names = this.getRelationNodes('../fjs-checkbox/fjs-checkbox')
        .filter((c) => c.data.on)
        .map((c) => c.data.name);
      this.triggerEvent('change', { value: JSON.stringify(names) });
    },
  },
});
