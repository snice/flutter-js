// The scrolling semantics both platforms implement, written once.
//
// Neither side imports the other's code — Flutter's widgets are Dart — so
// "the two ends agree" has to come from somewhere. This file is that
// somewhere: it is the SPEC as much as it is the implementation. The web
// adapter calls these functions; `widgets/scroll_view.dart` mirrors them
// line for line and points back here in its comments. Change one, change
// both, and the tests in test/scroll-metrics.test.ts say what "correct"
// means for either.
//
// Three things live here because all three are easy to get subtly wrong and
// hard to notice: the payload's field order, the "have I already reported
// this edge" state machine, and circular index wrapping.

/** What a `@scroll` event carries. Field names are the mini program's. */
export interface ScrollDetail {
  scrollTop: number;
  scrollLeft: number;
  scrollHeight: number;
  scrollWidth: number;
  deltaX: number;
  deltaY: number;
}

/** Serializes a scroll event.
 *
 * The key ORDER is part of the contract: a page comparing payloads (or a
 * test asserting one) sees the same string from both platforms only if both
 * write the fields in this order. Values are rounded to one decimal — a
 * device reports subpixel offsets that differ between platforms and mean
 * nothing to a page. */
export function scrollPayload(detail: ScrollDetail): string {
  const round = (n: number) => Math.round(n * 10) / 10;
  return JSON.stringify({
    scrollTop: round(detail.scrollTop),
    scrollLeft: round(detail.scrollLeft),
    scrollHeight: round(detail.scrollHeight),
    scrollWidth: round(detail.scrollWidth),
    deltaX: round(detail.deltaX),
    deltaY: round(detail.deltaY),
  });
}

export type ScrollEdge = 'upper' | 'lower' | null;

export interface EdgeInput {
  /** Current offset along the scrolling axis. */
  offset: number;
  /** Viewport extent along that axis. */
  viewport: number;
  /** Total content extent along that axis. */
  content: number;
  upperThreshold: number;
  lowerThreshold: number;
}

export const DEFAULT_SCROLL_THRESHOLD = 50;

/** Which edge zone an offset is in, ignoring history.
 *
 * Callers PRIME their state with this at mount: a list that opens at the top
 * is already in the upper zone, and reporting "reached the top" before the
 * user has done anything would be noise — the mini program does not do it
 * either. After priming, [edgeTransition] only speaks on a real crossing. */
export function edgeZone(input: EdgeInput): ScrollEdge {
  const maxOffset = Math.max(0, input.content - input.viewport);
  if (input.offset <= input.upperThreshold) return 'upper';
  if (input.offset >= maxOffset - input.lowerThreshold) return 'lower';
  return null;
}

/** The edge to REPORT, given where we were last time.
 *
 * A single flick to the bottom produces a scroll notification on every
 * frame, and a plain "am I near the end" test would fire `scrolltolower` on
 * every one of them — the mini program's own docs warn about exactly this.
 * Reporting only the transition INTO a zone turns that into one event, and
 * leaving the zone re-arms it.
 *
 * Returns the edge to dispatch (or null), and the state to carry forward. */
export function edgeTransition(
  previous: ScrollEdge,
  input: EdgeInput,
): { emit: ScrollEdge; state: ScrollEdge } {
  const zone = edgeZone(input);
  if (zone === previous) return { emit: null, state: zone };
  return { emit: zone, state: zone };
}

/** Wraps a page index for `circular`.
 *
 * Flutter reaches this with an unbounded PageView (a large index modulo the
 * page count) and the web with duplicated edge pages (index -1 or count),
 * so it has to handle both far-out and just-past-the-edge inputs. The
 * result is always a real index, which is what `@change` reports — a page
 * never sees a clone's number. */
export function wrapIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  const wrapped = index % count;
  return wrapped < 0 ? wrapped + count : wrapped;
}
