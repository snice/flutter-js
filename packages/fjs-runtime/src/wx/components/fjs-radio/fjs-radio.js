// fjs <radio> on wx — the circle twin of fjs-checkbox (web/components/form.ts
// FjsRadio). Tapping the selected one is a no-op; the group turns the others
// off silently, the way the web control's setChecked does.
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
    '../fjs-radio-group/fjs-radio-group': { type: 'ancestor' },
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
    toggle() {
      if (this.data.disabled || this.data.on) return;
      this.setData({ on: true });
      this.triggerEvent('change', { value: '1' });
      const group = this.getRelationNodes('../fjs-radio-group/fjs-radio-group')[0];
      if (group) group.childSelected(this);
    },
    setOn(on) {
      if (this.data.on !== on) this.setData({ on });
    },
  },
});
