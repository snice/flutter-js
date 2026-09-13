// fjs <checkbox> on wx. The native wx checkbox has a different contract
// (checked state in `checked`, `value` is an identifier, change only fires
// on checkbox-group), so the fjs one is drawn here, the same way the web
// adapter draws it (web/components/form.ts FjsCheckbox): a 20px box plus the
// label slot, the whole control toggles, change carries "1" / "0".
Component({
  properties: {
    // flex layout copied from the page's classes on this host (compiler)
    layout: { type: String, value: '' },
    value: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    name: { type: String, value: '' },
  },
  data: { on: false },
  relations: {
    '../fjs-checkbox-group/fjs-checkbox-group': { type: 'ancestor' },
    '../fjs-label/fjs-label': { type: 'ancestor' },
  },
  observers: {
    value(v) {
      this.setData({ on: !!v });
    },
  },
  lifetimes: {
    attached() {
      this.setData({ on: !!this.data.value });
    },
  },
  methods: {
    // also called by fjs-label when its row is tapped
    toggle() {
      if (this.data.disabled) return;
      this.setData({ on: !this.data.on });
      this.triggerEvent('change', { value: this.data.on ? '1' : '0' });
      const group = this.getRelationNodes('../fjs-checkbox-group/fjs-checkbox-group')[0];
      if (group) group.childChanged();
    },
  },
});
