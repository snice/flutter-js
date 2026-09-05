// Path2D and the path sub-stream encoder.
//
// A path is recorded as commands, not as resolved geometry: flattening arcs
// and beziers here would mean re-implementing the host's curve tessellation
// in JS and would throw away the resolution independence that makes a vector
// path look right at any device pixel ratio.
//
// The SVG-string constructor (`new Path2D("M0 0 L10 10")`) is out of scope
// (spec §2); it is a second parser for a syntax nothing in this runtime
// speaks.
import { ByteBuf, PathCmd } from './display-list';
import { warnCanvasOnce } from './warn';

/** A recorded path. `Path2D` is this class; the context's own current path
 * is an instance of it too, which is what makes `fill()` and `fill(path)` the
 * same code. */
export class FjsPath2D {
  /** Encoded path commands. */
  readonly buf = new ByteBuf();
  /** Where the current subpath started, for closePath and for arc's implicit
   * line. Null when there is no current point. */
  private startX = 0;
  private startY = 0;
  private hasStart = false;
  private lastX = 0;
  private lastY = 0;

  constructor(source?: FjsPath2D | string) {
    if (typeof source === 'string') {
      warnCanvasOnce(
        'path2d-svg',
        'new Path2D(<svg string>) is not supported; build the path with ' +
          'moveTo/lineTo/arc instead (see docs/canvas-compat.md).',
      );
      return;
    }
    if (source) this.addPath(source);
  }

  get isEmpty(): boolean {
    return this.buf.length === 0;
  }

  get currentX(): number {
    return this.lastX;
  }

  get currentY(): number {
    return this.lastY;
  }

  get hasCurrentPoint(): boolean {
    return this.hasStart;
  }

  addPath(other: FjsPath2D): void {
    if (other.buf.length === 0) return;
    this.buf.bytes(other.snapshot());
    this.hasStart = other.hasStart;
    this.lastX = other.lastX;
    this.lastY = other.lastY;
    this.startX = other.startX;
    this.startY = other.startY;
  }

  /** The bytes so far, without consuming them (unlike ByteBuf.take). */
  snapshot(): Uint8Array {
    return this.buf.peek();
  }

  moveTo(x: number, y: number): void {
    this.buf.u8(PathCmd.MoveTo);
    this.buf.f32(x);
    this.buf.f32(y);
    this.startX = x;
    this.startY = y;
    this.hasStart = true;
    this.lastX = x;
    this.lastY = y;
  }

  lineTo(x: number, y: number): void {
    if (!this.hasStart) return this.moveTo(x, y);
    this.buf.u8(PathCmd.LineTo);
    this.buf.f32(x);
    this.buf.f32(y);
    this.lastX = x;
    this.lastY = y;
  }

  bezierCurveTo(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x: number,
    y: number,
  ): void {
    if (!this.hasStart) this.moveTo(x1, y1);
    this.buf.u8(PathCmd.CubicTo);
    this.buf.f32(x1);
    this.buf.f32(y1);
    this.buf.f32(x2);
    this.buf.f32(y2);
    this.buf.f32(x);
    this.buf.f32(y);
    this.lastX = x;
    this.lastY = y;
  }

  quadraticCurveTo(x1: number, y1: number, x: number, y: number): void {
    if (!this.hasStart) this.moveTo(x1, y1);
    this.buf.u8(PathCmd.QuadTo);
    this.buf.f32(x1);
    this.buf.f32(y1);
    this.buf.f32(x);
    this.buf.f32(y);
    this.lastX = x;
    this.lastY = y;
  }

  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise = false,
  ): void {
    this.buf.u8(PathCmd.Arc);
    this.buf.f32(x);
    this.buf.f32(y);
    this.buf.f32(radius);
    this.buf.f32(startAngle);
    this.buf.f32(endAngle);
    this.buf.u8(counterclockwise ? 1 : 0);
    this.hasStart = true;
    this.lastX = x + radius * Math.cos(endAngle);
    this.lastY = y + radius * Math.sin(endAngle);
  }

  /** DOM `arcTo` is a **corner fillet**: the arc is tangent to the segment
   *  coming in from the current point and to the one going out towards
   *  (x2, y2), and it ENDS AT THE TANGENT POINT — not at (x2, y2), which is
   *  only ever a direction. That is why it is lowered here instead of being
   *  sent as its own command: Flutter has no fillet, only `arcToPoint` (the
   *  SVG arc), whose end point IS the point you hand it, so the two draw
   *  completely different curves — a rounded rectangle came out as a barrel,
   *  with each corner bulging across a whole side.
   *
   *  The tangent points are plain trigonometry and the same on both ends, so
   *  computing them here leaves the host with `lineTo` + `arc`, two commands
   *  it already agrees with the browser about. (HTML spec, "arcTo".) */
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void {
    // the DOM throws IndexSizeError here; throwing keeps the two ends the same
    if (!(radius >= 0)) {
      throw new RangeError(`arcTo: radius must be >= 0, got ${radius}`);
    }
    // No current point: the spec starts the subpath at (x1, y1), and every
    // branch below would then be a zero-length line back to it.
    if (!this.hasStart) {
      this.moveTo(x1, y1);
      return;
    }
    const inX = this.lastX - x1;
    const inY = this.lastY - y1;
    const outX = x2 - x1;
    const outY = y2 - y1;
    const inLen = Math.hypot(inX, inY);
    const outLen = Math.hypot(outX, outY);
    // a degenerate corner (coincident points, no radius) is a plain line to
    // the corner, per spec
    if (inLen === 0 || outLen === 0 || radius === 0) {
      this.lineTo(x1, y1);
      return;
    }
    const ux = inX / inLen;
    const uy = inY / inLen;
    const vx = outX / outLen;
    const vy = outY / outLen;
    // sin and cos of the angle at the corner, from the incoming ray to the
    // outgoing one
    const cross = ux * vy - uy * vx;
    // three points on one line: no corner to round, again a plain line
    if (Math.abs(cross) < 1e-9) {
      this.lineTo(x1, y1);
      return;
    }
    const dot = Math.min(1, Math.max(-1, ux * vx + uy * vy));
    const half = Math.acos(dot) / 2;
    // corner -> tangent point along each ray, and corner -> centre along the
    // bisector: the two legs of the right triangle the fillet makes
    const along = radius / Math.tan(half);
    const toCentre = radius / Math.sin(half);
    const startX = x1 + ux * along;
    const startY = y1 + uy * along;
    const endX = x1 + vx * along;
    const endY = y1 + vy * along;
    const bisectorX = ux + vx;
    const bisectorY = uy + vy;
    const bisectorLen = Math.hypot(bisectorX, bisectorY);
    const cx = x1 + (bisectorX / bisectorLen) * toCentre;
    const cy = y1 + (bisectorY / bisectorLen) * toCentre;
    this.lineTo(startX, startY);
    this.arc(
      cx,
      cy,
      radius,
      Math.atan2(startY - cy, startX - cx),
      Math.atan2(endY - cy, endX - cx),
      // y grows downward, so a right turn (cross < 0) is the one that sweeps
      // with increasing angle — which is what canvas calls clockwise
      cross > 0,
    );
  }

  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise = false,
  ): void {
    this.buf.u8(PathCmd.Ellipse);
    this.buf.f32(x);
    this.buf.f32(y);
    this.buf.f32(radiusX);
    this.buf.f32(radiusY);
    this.buf.f32(rotation);
    this.buf.f32(startAngle);
    this.buf.f32(endAngle);
    this.buf.u8(counterclockwise ? 1 : 0);
    this.hasStart = true;
    this.lastX = x + radiusX * Math.cos(endAngle);
    this.lastY = y + radiusY * Math.sin(endAngle);
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.buf.u8(PathCmd.Rect);
    this.buf.f32(x);
    this.buf.f32(y);
    this.buf.f32(w);
    this.buf.f32(h);
    // a rect leaves the current point at its origin, per the spec
    this.startX = x;
    this.startY = y;
    this.hasStart = true;
    this.lastX = x;
    this.lastY = y;
  }

  roundRect(): void {
    warnCanvasOnce(
      'roundRect',
      'ctx.roundRect() is not supported; build the corners with arcTo ' +
        '(see docs/canvas-compat.md).',
    );
  }

  closePath(): void {
    if (!this.hasStart) return;
    this.buf.u8(PathCmd.Close);
    this.lastX = this.startX;
    this.lastY = this.startY;
  }

  reset(): void {
    this.buf.reset();
    this.hasStart = false;
    this.lastX = 0;
    this.lastY = 0;
  }
}
