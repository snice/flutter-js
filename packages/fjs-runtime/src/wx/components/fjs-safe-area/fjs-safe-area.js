// fjs <safe-area> on wx. env(safe-area-inset-*) is unreliable in the
// DevTools webview simulator, so the insets come from the window info
// instead — deterministic in both renderers, simulator and device.
//
// Flutter's SafeArea pads only what the system UI covers, and an outer one
// removes the insets from the MediaQuery it hands down, so a nested one pads
// nothing. The same two rules here:
//   * nested: this box's top edge already sits below the status bar (the
//     shell's safe-area around a page that uses another) -> no insets. The
//     top edge is measured: it does not move with this box's own padding.
//     Relations cannot link the two — the shell and the page are different
//     component trees and relations do not cross the slot.
//   * outermost: top = status bar; bottom = the home-indicator strip, except
//     on a tab page, where the native tabBar already sits over it.
// The bottom edge is deliberately NOT measured: the webview renderer reports
// a box that grows with its own padding and content while it lays out, and
// a measured bottom once turned into a ~600px padding that squeezed the
// shell's scroll-view to nothing (content painted outside every hit area,
// so no tap or :active reached it).
function ownerPagePath(self) {
  let node = self;
  for (let i = 0; i < 20 && node && typeof node.selectOwnerComponent === 'function'; i++) {
    const owner = node.selectOwnerComponent();
    if (!owner || owner === node) break;
    node = owner;
  }
  if (node && node.route) return node.route;
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
  const top = pages[pages.length - 1];
  return top ? top.route : '';
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
      this.apply(false);
    },
    ready() {
      this.createSelectorQuery()
        .select('.fjs-safe-area-root')
        .boundingClientRect((rect) => {
          const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
          const nested = !!rect && rect.top >= (info.statusBarHeight || 0) && rect.top > 0;
          this.apply(nested);
        })
        .exec();
    },
  },
  methods: {
    apply(nested) {
      let pad = '';
      if (!nested) {
        const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
        const safe = info.safeArea;
        const wxrt = globalThis.__fjsWx;
        const tab = !!(wxrt && wxrt.isTabPagePath && wxrt.isTabPagePath(ownerPagePath(this)));
        const top = info.statusBarHeight || 0;
        const bottom = safe && !tab ? Math.max(0, Math.round(info.screenHeight - safe.bottom)) : 0;
        const left = safe ? Math.max(0, Math.round(safe.left)) : 0;
        const right = safe ? Math.max(0, Math.round(info.screenWidth - safe.right)) : 0;
        pad = `padding: ${top}px ${right}px ${bottom}px ${left}px`;
      }
      if (pad !== this.data.pad) this.setData({ pad });
    },
  },
});
