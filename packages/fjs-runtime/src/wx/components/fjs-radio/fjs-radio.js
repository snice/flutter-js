// fjs <radio> on wx — the circle twin of fjs-checkbox (web/components/form.ts
// FjsRadio). Tapping the selected one is a no-op; the group turns the others
// off silently, the way the web control's setChecked does.
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
    '../fjs-radio-group/fjs-radio-group': {
      type: 'ancestor',
      linked(group) {
        this.setData({ inGroup: true, key: this.data.name || this.data.key, name: '' });
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
    toggle() {
      if (this.data.disabled || this.data.on) return;
      this.setData({ on: true, value: true });
      this.triggerEvent('change', { value: '1' });
      const group = this.getRelationNodes('../fjs-radio-group/fjs-radio-group')[0];
      if (group) group.childSelected(this);
    },
    setOn(on) {
      if (this.data.on !== on) this.setData({ on, value: on });
    },
  },
});
