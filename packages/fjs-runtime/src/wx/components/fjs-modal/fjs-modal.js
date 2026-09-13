// fjs <modal> on wx. Emits the same kebab event name the compiler maps
// @modal-closed to; no close button of its own (the fjs modal is a bare
// overlay — pages draw their own content and close it from the backdrop).
Component({
  options: {
    multipleSlots: true,
  },
  properties: {
    visible: { type: Boolean, value: false },
  },
  methods: {
    onMask() {
      this.triggerEvent('modal-closed');
    },
  },
});
