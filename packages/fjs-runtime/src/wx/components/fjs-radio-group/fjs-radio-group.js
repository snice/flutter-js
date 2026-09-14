// fjs <radio-group> on wx: mutual exclusion over its fjs-radio descendants;
// change carries the selected radio's name (docs/ui-api.md).
// In a <form> the group is the field: `name` is its key and `value` the
// selected radio's name, '' when none (components/form.ts typedValue).
Component({
  behaviors: ['wx://form-field'],
  properties: {
    // flex layout copied from the page's classes on this host (compiler)
    layout: { type: String, value: '' },
    name: { type: String, value: '' },
    value: { type: null, value: '' },
  },
  relations: {
    '../fjs-radio/fjs-radio': { type: 'descendant' },
  },
  methods: {
    // form value only, no event: a member linked or left
    refresh() {
      const on = this.getRelationNodes('../fjs-radio/fjs-radio').find((r) => r.data.on || r.data.value);
      this.setData({ value: on ? on.data.key || on.data.name : '' });
    },
    childSelected(target) {
      for (const r of this.getRelationNodes('../fjs-radio/fjs-radio')) {
        if (r !== target) r.setOn(false);
      }
      const name = target.data.key || target.data.name;
      this.setData({ value: name });
      this.triggerEvent('change', { value: name });
    },
  },
});
