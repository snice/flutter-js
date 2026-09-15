// fjs <sticky-section> for the WEBVIEW renderer (specs/053): a plain block
// container, the twin of web/components/sticky.ts FjsStickySection. CSS
// sticky bounds each header to this box — which IS the between-sections
// behaviour — so push-pinned-header has nothing to change (registered
// difference, spec 052 §4). virtualHost for the same reason as
// fjs-sticky-header: the box must be the page's real child.
Component({
  options: { virtualHost: true, mergeVirtualHostAttributes: true },
  properties: {
    pushPinnedHeader: { type: null, value: true },
  },
});
