// Two-finger pinch, with no 3D in it.
//
// The two glTF viewers have different camera models — one hand-rolled
// `lookAt`, one three.js `PerspectiveCamera` — but the gesture is the same
// arithmetic in both, so it lives here and answers exactly one question:
// how much did the gap between the fingers change since the last move?
// What that ratio does to a camera is the page's business.
//
// State is per-instance, not module-level: both viewers can be alive at
// once (one is mounted while the other is still tearing down on a route
// pop), and a shared baseline would make the second page's first pinch
// jump.
// NOT UNDER TEST: `examples/hello-fjs` has no vitest project, so nothing
// here is covered by `pnpm test` — a green run says nothing about this file
// (constitution V: a skipped test has to say so out loud). The behaviour it
// exists for is verified by hand on both platforms: spread/close, the limits
// holding, and above all the two jump cases below (a new finger pair, and
// dropping back to one finger). Change the baseline logic and re-run those.
import type { FjsTouchEvent, FjsTouch } from 'fjs';

export interface Pinch {
  /** The factor the finger gap grew by since the previous move — >1 when
   * the fingers spread, <1 when they close. `null` means "this is not a
   * two-finger gesture", and the caller should handle it as a one-finger
   * drag. The FIRST move of a pinch also answers `null`: there is nothing
   * to compare against yet, only a baseline to remember. */
  ratio(e: FjsTouchEvent): number | null;
  /** Forget the baseline (a page calls this on touchend/touchcancel). */
  reset(): void;
}

function gap(a: FjsTouch, b: FjsTouch): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

export function createPinch(): Pinch {
  let lastGap = 0;
  // Which two fingers the baseline belongs to. A pinch that loses a finger
  // and gains another one is a NEW pinch: comparing the new pair's gap
  // against the old pair's would jump the model by whatever the two pairs
  // happen to differ by. Same reason `touches.length` dropping below 2
  // clears the baseline rather than keeping it for later.
  let pair = '';

  return {
    ratio(e: FjsTouchEvent): number | null {
      const [a, b] = e.touches;
      if (!a || !b) {
        lastGap = 0;
        pair = '';
        return null;
      }
      const key = `${a.identifier}:${b.identifier}`;
      const current = gap(a, b);
      // Two fingers on the same pixel: no baseline worth keeping, and the
      // division below would be Infinity.
      if (current <= 0) return null;
      if (key !== pair || lastGap <= 0) {
        pair = key;
        lastGap = current;
        return null;
      }
      const factor = current / lastGap;
      lastGap = current;
      return factor;
    },
    reset(): void {
      lastGap = 0;
      pair = '';
    },
  };
}
