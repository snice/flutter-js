// arcTo is a corner fillet, and the host has no fillet.
//
// The DOM's arcTo(x1, y1, x2, y2, r) rounds the corner between the segment
// coming in from the current point and the one going out towards (x2, y2).
// The arc ends at the TANGENT POINT; (x2, y2) is only a direction. Flutter's
// arcToPoint is the SVG arc and ends AT the point it is given, so sending the
// command through drew an arc across a whole side — a rounded rectangle came
// out as a barrel. The runtime therefore computes the tangent points and
// sends lineTo + arc, which the host and the browser already agree on.
//
// These pin the lowering: the emitted commands, the geometry, and the spec's
// degenerate cases.
import { describe, expect, it } from 'vitest';

import { FjsPath2D } from '../src/canvas/path2d';
import { PathCmd } from '../src/canvas/display-list';

interface Step {
  cmd: number;
  args: number[];
}

/** How many f32 arguments each command carries (the Arc's flag reads as one
 * more byte, handled below). */
const ARGS: Record<number, number> = {
  [PathCmd.MoveTo]: 2,
  [PathCmd.LineTo]: 2,
  [PathCmd.CubicTo]: 6,
  [PathCmd.QuadTo]: 4,
  [PathCmd.Arc]: 5,
  [PathCmd.Ellipse]: 7,
  [PathCmd.Rect]: 4,
  [PathCmd.Close]: 0,
};

function decode(path: FjsPath2D): Step[] {
  const bytes = path.snapshot();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Step[] = [];
  let i = 0;
  while (i < bytes.length) {
    const cmd = bytes[i++];
    const args: number[] = [];
    for (let n = 0; n < ARGS[cmd]; n++) {
      args.push(view.getFloat32(i, true));
      i += 4;
    }
    // arc and ellipse end with the counterclockwise flag
    if (cmd === PathCmd.Arc || cmd === PathCmd.Ellipse) args.push(bytes[i++]);
    out.push({ cmd, args });
  }
  return out;
}

const near = (v: number, expected: number) => expect(v).toBeCloseTo(expected, 4);

describe('arcTo', () => {
  it('rounds the corner and ends at the tangent point, not at (x2, y2)', () => {
    // the top-right corner of a rounded rect: along the top edge, turning down
    const path = new FjsPath2D();
    path.moveTo(10, 0);
    path.arcTo(100, 0, 100, 50, 10);

    const steps = decode(path);
    expect(steps.map((s) => s.cmd)).toEqual([
      PathCmd.MoveTo,
      PathCmd.LineTo,
      PathCmd.Arc,
    ]);

    // the line stops one radius short of the corner
    near(steps[1].args[0], 90);
    near(steps[1].args[1], 0);

    const [cx, cy, r, start, end, ccw] = steps[2].args;
    near(cx, 90);
    near(cy, 10);
    near(r, 10);
    near(start, -Math.PI / 2);
    near(end, 0);
    // y grows downward, so this right turn sweeps with increasing angle
    expect(ccw).toBe(0);

    // and the current point is the second tangent point — a rounded rect's
    // next side starts there, not at the corner it aimed at
    near(path.currentX, 100);
    near(path.currentY, 10);
  });

  it('sweeps the other way round a left turn', () => {
    // same corner mirrored: along the top edge to the left, turning down
    const path = new FjsPath2D();
    path.moveTo(100, 0);
    path.arcTo(10, 0, 10, 50, 10);
    const arc = decode(path)[2];
    near(arc.args[0], 20);
    near(arc.args[1], 10);
    expect(arc.args[5]).toBe(1);
  });

  it('is a plain line when there is no corner to round', () => {
    // three points on one line, per spec
    const straight = new FjsPath2D();
    straight.moveTo(0, 0);
    straight.arcTo(10, 0, 20, 0, 5);
    expect(decode(straight).map((s) => s.cmd)).toEqual([
      PathCmd.MoveTo,
      PathCmd.LineTo,
    ]);
    expect(decode(straight)[1].args).toEqual([10, 0]);

    // ...and when the radius is zero, or two of the points coincide
    for (const build of [
      (p: FjsPath2D) => p.arcTo(10, 0, 10, 10, 0),
      (p: FjsPath2D) => p.arcTo(0, 0, 10, 10, 5),
      (p: FjsPath2D) => p.arcTo(10, 0, 10, 0, 5),
    ]) {
      const path = new FjsPath2D();
      path.moveTo(0, 0);
      build(path);
      expect(decode(path).map((s) => s.cmd)).toEqual([
        PathCmd.MoveTo,
        PathCmd.LineTo,
      ]);
    }
  });

  it('starts the subpath when the path has no current point', () => {
    const path = new FjsPath2D();
    path.arcTo(10, 20, 30, 40, 5);
    expect(decode(path)).toEqual([{ cmd: PathCmd.MoveTo, args: [10, 20] }]);
  });

  it('refuses a negative radius, as the DOM does', () => {
    const path = new FjsPath2D();
    path.moveTo(0, 0);
    expect(() => path.arcTo(10, 0, 10, 10, -1)).toThrow(RangeError);
  });

  it('four corners make a rounded rectangle that closes on itself', () => {
    // what a page actually writes; every corner must land back on an edge
    const path = new FjsPath2D();
    const r = 8;
    path.moveTo(r, 0);
    path.arcTo(100, 0, 100, 60, r);
    path.arcTo(100, 60, 0, 60, r);
    path.arcTo(0, 60, 0, 0, r);
    path.arcTo(0, 0, 100, 0, r);
    path.closePath();

    const arcs = decode(path).filter((s) => s.cmd === PathCmd.Arc);
    expect(arcs).toHaveLength(4);
    // the four centres sit one radius inside each corner
    expect(
      arcs.map((a) => [Math.round(a.args[0]), Math.round(a.args[1])]),
    ).toEqual([
      [92, 8],
      [92, 52],
      [8, 52],
      [8, 8],
    ]);
    // all four turn the same way
    expect(arcs.every((a) => a.args[5] === 0)).toBe(true);
  });
});
