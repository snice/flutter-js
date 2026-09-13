// fjs <progress> on wx. The native one takes a 0-100 `percent` and has no
// indeterminate or circular form; the fjs one takes value 0-1, is
// indeterminate without a value and turns into a spinner with
// type="circular" (web/components/form.ts FjsProgress).
Component({
  properties: {
    value: { type: null, value: null },
    type: { type: String, value: 'linear' },
  },
  data: { fill: 0, rest: 1, indeterminate: true },
  observers: {
    value(v) {
      this.sync(v);
    },
  },
  lifetimes: {
    attached() {
      this.sync(this.data.value);
    },
  },
  methods: {
    sync(v) {
      const indeterminate = v === null || v === undefined || v === '';
      const fill = indeterminate ? 0 : Math.max(0, Math.min(1, Number(v) || 0));
      this.setData({ indeterminate, fill, rest: 1 - fill });
    },
  },
});
