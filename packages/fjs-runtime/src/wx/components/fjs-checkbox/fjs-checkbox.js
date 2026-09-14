// fjs <checkbox> on wx. The native wx checkbox has a different contract
// (checked state in `checked`, `value` is an identifier, change only fires
// on checkbox-group), so the fjs one is drawn here, the same way the web
// adapter draws it (web/components/form.ts FjsCheckbox): a 20px box plus the
// label slot, the whole control toggles, change carries "1" / "0".
// Form (docs/ui-api.md form): a native <form> collects custom components
// that carry wx://form-field, reading their `name` / `value` properties — so
// a toggle writes its state back into `value`. Inside a group the group
// reports for its members (components/form.ts), and `name` is the member's
// identifier within the group, not a form key: once linked to a group the
// member keeps it in `key` and clears `name`, which the form skips (a field
// with an empty name is not collected — DevTools-verified).
Component({
  behaviors: ['wx://form-field'],
  properties: {
    // flex layout copied from the page's classes on this host (compiler)
    layout: { type: String, value: '' },
    value: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    name: { type: String, value: '' },
  },
  data: { on: false, key: '', inGroup: false },
  relations: {
    '../fjs-checkbox-group/fjs-checkbox-group': {
      type: 'ancestor',
      linked(group) {
        this.enterGroup();
        group.refresh();
      },
      unlinked(group) {
        this.setData({ inGroup: false, name: this.data.key });
        group.refresh();
      },
    },
    '../fjs-label/fjs-label': { type: 'ancestor' },
  },
  observers: {
    value(v) {
      this.setData({ on: !!v });
    },
    name(v) {
      if (!v) return;
      this.setData({ key: v });
      if (this.data.inGroup) this.setData({ name: '' });
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
      const on = !this.data.on;
      this.setData({ on, value: on });
      this.triggerEvent('change', { value: this.data.on ? '1' : '0' });
      const group = this.getRelationNodes('../fjs-checkbox-group/fjs-checkbox-group')[0];
      if (group) group.childChanged();
    },
    enterGroup() {
      this.setData({ inGroup: true, key: this.data.name || this.data.key, name: '' });
    },
  },
});
