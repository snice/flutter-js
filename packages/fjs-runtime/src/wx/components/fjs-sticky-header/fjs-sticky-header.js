// fjs <sticky-header> for the WEBVIEW renderer (specs/053) — skyline uses
// the native component and never ships this file. The webview has no such
// built-in, so the behaviour is rebuilt from CSS `position: sticky` plus a
// measured pin state:
//
// virtualHost is what makes the CSS work at all. sticky pins within the
// PARENT box; a real host element between the page and the sticky view
// would BE that parent (and only header-height tall), so the header could
// never travel. As a virtual host, the view below is a real node in the
// page's flow and the pin bounds are the page's own container, exactly as
// on the web substrate (web/components/sticky.ts).
//
// The pin state is measured on every scroll frame of the hosting
// scroll-view: the compiler binds that scroller's `bindscroll` to the
// page's __fjsStickyTick, which ticks every header registered here (an
// IntersectionObserver cannot see the pin moment of a fully visible
// header — its intersection ratio never changes). Each tick re-measures
// with the web component's formula: stuck ⇔ |rect.top − top| ≤ 2. The
// initial measure registers silently: the event reports CHANGES, and a
// header sitting naturally at the line has not stuck yet.
Component({
  options: { virtualHost: true, mergeVirtualHostAttributes: true },
  properties: {
    offsetTop: { type: null, value: 0 },
    // WeChat props accepted for page compatibility; inert in CSS terms
    allowOverlapping: { type: null, value: false },
    padding: { type: null, value: null },
  },
  data: { top: 0, stuck: false },
  observers: {
    offsetTop(v) {
      this.applyTop(v);
    },
  },
  lifetimes: {
    attached() {
      this.applyTop(this.data.offsetTop);
      this.register();
    },
    detached() {
      this.unregister();
    },
  },
  methods: {
    applyTop(v) {
      const n = Number(v);
      const top = Number.isFinite(n) ? n : 0;
      if (top !== this.data.top) this.setData({ top });
    },
    register() {
      const app = typeof getApp === 'function' ? getApp() : null;
      if (!app) return;
      if (!app.__fjsStickyHeaders) app.__fjsStickyHeaders = [];
      const tick = () => this.measureThrottled();
      tick.__fjsOwner = this;
      app.__fjsStickyHeaders.push(tick);
      this._registered = true;
      // one silent prime after the first layout, then events on flips only
      setTimeout(() => this.measure(), 0);
    },
    unregister() {
      const app = typeof getApp === 'function' ? getApp() : null;
      if (this._registered && app && app.__fjsStickyHeaders) {
        const list = app.__fjsStickyHeaders;
        const i = list.findIndex((t) => t && t.__fjsOwner === this);
        if (i >= 0) list.splice(i, 1);
      }
      this._registered = false;
      if (this._timer) {
        clearTimeout(this._timer);
        this._timer = null;
      }
    },
    // one selectorQuery per header per ~2 frames, however fast the scroll
    // events arrive — the event only reports flips, this just bounds the
    // measurement cost
    measureThrottled() {
      if (this._timer) return;
      this._timer = setTimeout(() => {
        this._timer = null;
        this.measure();
      }, 33);
    },
    measure() {
      this.createSelectorQuery()
        .select('.fjs-sticky-header')
        .boundingClientRect((rect) => {
          if (!rect || typeof rect.top !== 'number') return;
          // like web/sticky.ts: not laid out yet reads as all-zero
          if (rect.top === 0 && !rect.height) return;
          // the query's rect is viewport-relative, but the pin line hangs
          // off the HOST SCROLLER's top — the scroller usually sits
          // mid-page (the specs/052 web regression). The page tick measures
          // every fjs-sticky-host's viewport top before ticking; pinned
          // ⇔ the header's edge sits at its host's top + offset-top.
          const tops = (getApp() || {}).__fjsStickyHostTops || [];
          const next = tops.some(
            (t) => Math.abs(rect.top - t - this.data.top) <= 2,
          );
          if (next !== this.data.stuck) {
            this.setData({ stuck: next });
            this.triggerEvent('stickontopchange', { isStickOnTop: next });
          }
        })
        .exec();
    },
  },
});
