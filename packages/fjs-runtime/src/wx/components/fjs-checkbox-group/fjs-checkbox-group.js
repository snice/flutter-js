// fjs <checkbox-group> on wx: change carries the checked names as a JSON
// array string (docs/ui-api.md), in the order the checkboxes were linked —
// document order for a static list.
// In a <form> the group is the field: `name` is its key and `value` the
// checked names (components/form.ts typedValue), kept current here for the
// form's wx://form-field read.
Component({
  behaviors: ['wx://form-field'],
  properties: {
    // flex layout copied from the page's classes on this host (compiler)
    layout: { type: String, value: '' },
    name: { type: String, value: '' },
    value: { type: null, value: [] },
  },
  relations: {
    '../fjs-checkbox/fjs-checkbox': { type: 'descendant' },
  },
  methods: {
    checkedNames() {
      return this.getRelationNodes('../fjs-checkbox/fjs-checkbox')
        .filter((c) => c.data.on || c.data.value)
        .map((c) => c.data.key || c.data.name);
    },
    // form value only, no event: a member linked or left
    refresh() {
      this.setData({ value: this.checkedNames() });
    },
    childChanged() {
      const names = this.checkedNames();
      this.setData({ value: names });
      this.triggerEvent('change', { value: JSON.stringify(names) });
    },
  },
});
