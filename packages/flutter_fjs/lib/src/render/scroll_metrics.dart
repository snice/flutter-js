// The Dart half of the scrolling semantics.
//
// The rules themselves are written down once, in
// fjs-runtime/src/scroll/metrics.ts — payload field order, the "already
// reported this edge" state machine, circular index wrapping. This file
// mirrors them so the widgets can use them; if you change one, change both,
// and the two test files (test/scroll-metrics.test.ts here,
// scroll_view_props_test.dart there) say what correct means.
import 'dart:convert';

/// Rounds the way the JS side does: one decimal. A device reports subpixel
/// offsets the browser never produces, and a page comparing payloads should
/// not see that difference.
double _round(double value) => (value * 10).roundToDouble() / 10;

/// Serializes a `@scroll` event. The key ORDER is part of the contract.
String fjsScrollPayload({
  required double scrollTop,
  required double scrollLeft,
  required double scrollHeight,
  required double scrollWidth,
  required double deltaX,
  required double deltaY,
}) {
  Object number(double value) {
    final rounded = _round(value);
    // jsonEncode writes 12.0 where JS writes 12; match JS.
    return rounded == rounded.roundToDouble() ? rounded.toInt() : rounded;
  }

  return jsonEncode({
    'scrollTop': number(scrollTop),
    'scrollLeft': number(scrollLeft),
    'scrollHeight': number(scrollHeight),
    'scrollWidth': number(scrollWidth),
    'deltaX': number(deltaX),
    'deltaY': number(deltaY),
  });
}

enum FjsScrollEdge { upper, lower }

const double fjsDefaultScrollThreshold = 50;

/// Which edge zone an offset is in, ignoring history.
FjsScrollEdge? fjsEdgeZone({
  required double offset,
  required double viewport,
  required double content,
  double upperThreshold = fjsDefaultScrollThreshold,
  double lowerThreshold = fjsDefaultScrollThreshold,
}) {
  final maxOffset = (content - viewport).clamp(0.0, double.infinity);
  if (offset <= upperThreshold) return FjsScrollEdge.upper;
  if (offset >= maxOffset - lowerThreshold) return FjsScrollEdge.lower;
  return null;
}

/// The edge to REPORT given where we were last time.
///
/// One flick to the bottom produces a notification per frame; a plain "am I
/// near the end" test would fire on every one of them. Only the transition
/// INTO a zone is reported, and leaving re-arms it.
({FjsScrollEdge? emit, FjsScrollEdge? state}) fjsEdgeTransition(
  FjsScrollEdge? previous, {
  required double offset,
  required double viewport,
  required double content,
  double upperThreshold = fjsDefaultScrollThreshold,
  double lowerThreshold = fjsDefaultScrollThreshold,
}) {
  final zone = fjsEdgeZone(
    offset: offset,
    viewport: viewport,
    content: content,
    upperThreshold: upperThreshold,
    lowerThreshold: lowerThreshold,
  );
  if (zone == previous) return (emit: null, state: zone);
  return (emit: zone, state: zone);
}

/// Wraps a page index for `circular`. An unbounded PageView hands in a large
/// index; the result is always a real one, which is what `@change` reports.
int fjsWrapIndex(int index, int count) {
  if (count <= 0) return 0;
  final wrapped = index % count;
  return wrapped < 0 ? wrapped + count : wrapped;
}
