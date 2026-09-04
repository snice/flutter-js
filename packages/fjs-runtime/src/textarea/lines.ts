// What `@linechange` means, written once for both platforms.
//
// Same arrangement as scroll/metrics.ts: neither end imports the other's
// code, so the agreement has to live somewhere, and this file is it. The web
// adapter calls these functions; `widgets/input.dart` measures with a
// TextPainter and reports through the same shape, pointing back here.
//
// Two things are easy to get subtly wrong and hard to notice, so both are
// here rather than in either adapter: the payload's field order, and the
// "only a CHANGE is an event" rule.

/** What a `@linechange` event carries.
 *
 * `heightRpx` is deliberately absent. rpx is the mini program's design-width
 * unit; fjs has no such coordinate system, and inventing a conversion would
 * be worse than the field not being there (constitution V). */
export interface LineDetail {
  /** The CONTENT's height in logical pixels — not the box's. */
  height: number;
  lineCount: number;
}

/** Serializes a line-change event.
 *
 * Field order is part of the contract: a page comparing payloads, or a test
 * asserting one, only sees the same string from both platforms if both write
 * the fields in this order. `height` is rounded to one decimal because text
 * metrics differ in the last subpixel between platforms and mean nothing to
 * a page — `lineCount`, which pages actually branch on, is exact and must
 * agree. */
export function lineChangePayload(detail: LineDetail): string {
  return JSON.stringify({
    height: Math.round(detail.height * 10) / 10,
    lineCount: detail.lineCount,
  });
}

/** The "has this changed" gate.
 *
 * A multiline field reports its measurement on every keystroke — every
 * frame, on Flutter — but `@linechange` fires only when the number of lines
 * is different from the last one the page was told about. The first
 * measurement primes the state and is NOT reported: opening a field that is
 * already three lines tall is not "the line count changed", the same way
 * opening a scroll view at the top is not "scrolled to the top"
 * (scroll/metrics.ts). */
export class LineChangeState {
  private last: number | null = null;

  /** Records a measurement; returns the payload to emit, or null. */
  report(detail: LineDetail): string | null {
    const previous = this.last;
    this.last = detail.lineCount;
    if (previous === null || previous === detail.lineCount) return null;
    return lineChangePayload(detail);
  }

  /** Forgets the primed count — for when the field is re-created (a new
   * `value` from the page is NOT that: the count carries over). */
  reset(): void {
    this.last = null;
  }
}
