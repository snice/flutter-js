// fjs <safe-area> on wx. env(safe-area-inset-*) is unreliable in the
// DevTools webview simulator, so the insets come from the measured window
// info instead — deterministic in both renderers, simulator and device.
//
// Each safe-area pads only the part of its own box the system UI actually
// covers — what Flutter's SafeArea does, since an outer one removes the
// insets from the MediaQuery it hands down. A nested one (the shell's
// safe-area around a page that uses another) therefore pads nothing.
// Measured rather than linked through relations: the shell and the page are
// different component trees, and relations do not cross the slot.
const live = new Set();
let pending = 0;

function remeasureAll(rounds) {
  if (pending) return;
  pending = setTimeout(() => {
    pending = 0;
    for (const inst of live) inst.measure(rounds);
  }, 16);
}

Component({
  options: {
    multipleSlots: true,
  },
  data: {
    pad: '',
  },
  lifetimes: {
    attached() {
      live.add(this);
    },
    ready() {
      this.measure(3);
    },
    detached() {
      live.delete(this);
    },
  },
  methods: {
    measure(rounds) {
      const info = typeof wx.getWindowInfo === 'function'
        ? wx.getWindowInfo()
        : wx.getSystemInfoSync();
      const safe = info.safeArea;
      this.createSelectorQuery()
        .select('.fjs-safe-area-root')
        .boundingClientRect((rect) => {
          if (!rect) return;
          const statusBar = info.statusBarHeight || 0;
          const top = Math.max(0, Math.round(statusBar - rect.top));
          // window coordinates: on a tab page the native tabBar already sits
          // over the home indicator and the window ends above it
          const bottom = safe ? Math.max(0, Math.round(rect.bottom - Math.min(safe.bottom, info.windowHeight))) : 0;
          const left = safe ? Math.max(0, Math.round(safe.left - rect.left)) : 0;
          const right = safe ? Math.max(0, Math.round(rect.right - safe.right)) : 0;
          const pad = top || right || bottom || left
            ? `padding: ${top}px ${right}px ${bottom}px ${left}px`
            : '';
          if (pad === this.data.pad) return;
          this.setData({ pad });
          // this box moved the others: let every safe-area look again
          if (rounds > 0) remeasureAll(rounds - 1);
        })
        .exec();
    },
  },
});
