// The shared scrolling semantics (src/scroll/metrics.ts). Both platforms
// implement these rules, so this file is where "correct" is defined for
// either — the Dart side mirrors the same cases in
// flutter_fjs/test/scroll_view_props_test.dart.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCROLL_THRESHOLD,
  edgeTransition,
  edgeZone,
  scrollPayload,
  wrapIndex,
  type ScrollEdge,
} from '../src/scroll/metrics';

const metrics = (offset: number, over: Partial<Parameters<typeof edgeZone>[0]> = {}) => ({
  offset,
  viewport: 400,
  content: 1000,
  upperThreshold: DEFAULT_SCROLL_THRESHOLD,
  lowerThreshold: DEFAULT_SCROLL_THRESHOLD,
  ...over,
});

describe('scroll payload', () => {
  it('writes the six fields in a fixed order', () => {
    expect(
      scrollPayload({
        scrollTop: 12,
        scrollLeft: 0,
        scrollHeight: 1000,
        scrollWidth: 375,
        deltaX: 0,
        deltaY: 8,
      }),
    ).toBe(
      '{"scrollTop":12,"scrollLeft":0,"scrollHeight":1000,"scrollWidth":375,"deltaX":0,"deltaY":8}',
    );
  });

  it('rounds subpixel offsets away', () => {
    // iOS reports fractional offsets the other platform never produces;
    // a page comparing payloads should not see the difference.
    const payload = scrollPayload({
      scrollTop: 12.34567,
      scrollLeft: 0,
      scrollHeight: 1000.05,
      scrollWidth: 375,
      deltaX: 0,
      deltaY: -3.999,
    });
    expect(payload).toContain('"scrollTop":12.3');
    expect(payload).toContain('"deltaY":-4');
  });
});

describe('edge zones', () => {
  it('is upper at the very top and lower at the very bottom', () => {
    expect(edgeZone(metrics(0))).toBe('upper');
    expect(edgeZone(metrics(600))).toBe('lower'); // content 1000 - viewport 400
  });

  it('is neither in the middle', () => {
    expect(edgeZone(metrics(300))).toBeNull();
  });

  it('respects a custom threshold', () => {
    expect(edgeZone(metrics(80))).toBeNull();
    expect(edgeZone(metrics(80, { upperThreshold: 100 }))).toBe('upper');
  });

  it('calls a viewport taller than its content both edges at once', () => {
    // maxOffset is 0, so offset 0 is within both — upper wins, which is
    // what a non-scrollable list should report if anything.
    expect(edgeZone(metrics(0, { content: 100 }))).toBe('upper');
  });
});

describe('edge transitions', () => {
  it('reports an edge once on entry, not on every frame', () => {
    let state: ScrollEdge = null;
    const emitted: ScrollEdge[] = [];
    for (const offset of [560, 580, 590, 600]) {
      const step = edgeTransition(state, metrics(offset));
      state = step.state;
      if (step.emit) emitted.push(step.emit);
    }
    expect(emitted).toEqual(['lower']);
  });

  it('re-arms after leaving the zone', () => {
    let state: ScrollEdge = null;
    const emitted: ScrollEdge[] = [];
    for (const offset of [600, 300, 600]) {
      const step = edgeTransition(state, metrics(offset));
      state = step.state;
      if (step.emit) emitted.push(step.emit);
    }
    expect(emitted).toEqual(['lower', 'lower']);
  });

  it('reports the other edge when the scroll crosses the whole list', () => {
    let state: ScrollEdge = null;
    const emitted: ScrollEdge[] = [];
    for (const offset of [600, 300, 0]) {
      const step = edgeTransition(state, metrics(offset));
      state = step.state;
      if (step.emit) emitted.push(step.emit);
    }
    expect(emitted).toEqual(['lower', 'upper']);
  });

  it('says nothing about a zone it was primed into', () => {
    // A list that opens at the top is already in the upper zone; the widget
    // primes its state with edgeZone at mount so the page does not get a
    // "reached the top" before it has done anything.
    const primed = edgeZone(metrics(0));
    expect(edgeTransition(primed, metrics(0)).emit).toBeNull();
    // ...and still reports the far edge when the user actually gets there
    expect(edgeTransition(primed, metrics(600)).emit).toBe('lower');
  });
});

describe('circular index wrapping', () => {
  it('leaves a real index alone', () => {
    expect(wrapIndex(0, 3)).toBe(0);
    expect(wrapIndex(2, 3)).toBe(2);
  });

  it('wraps one past either end', () => {
    expect(wrapIndex(3, 3)).toBe(0);
    expect(wrapIndex(-1, 3)).toBe(2);
  });

  it('wraps a far-out index, the way an unbounded PageView produces one', () => {
    expect(wrapIndex(2 * 3, 3)).toBe(0);
    expect(wrapIndex(10000, 3)).toBe(1);
    expect(wrapIndex(-10000, 3)).toBe(2);
  });

  it('survives an empty swiper', () => {
    expect(wrapIndex(5, 0)).toBe(0);
  });
});
