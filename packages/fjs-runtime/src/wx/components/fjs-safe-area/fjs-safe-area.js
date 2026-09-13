// fjs <safe-area> on wx. env(safe-area-inset-*) is unreliable in the
// DevTools webview simulator, so the insets come from the measured window
// info instead — deterministic in both renderers, simulator and device.
Component({
  options: {
    multipleSlots: true,
  },
  data: {
    pad: '0rpx',
  },
  lifetimes: {
    attached() {
      const info = typeof wx.getWindowInfo === 'function'
        ? wx.getWindowInfo()
        : wx.getSystemInfoSync();
      const safe = info.safeArea;
      const top = info.statusBarHeight || 0;
      const bottom = safe ? Math.max(0, info.screenHeight - safe.bottom) : 0;
      const left = safe ? safe.left : 0;
      const right = safe ? Math.max(0, info.screenWidth - safe.right) : 0;
      this.setData({ pad: `${top}px ${right}px ${bottom}px ${left}px` });
    },
  },
});
