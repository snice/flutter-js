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

  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void {
    if (!this.hasStart) this.moveTo(x1, y1);
    this.buf.u8(PathCmd.ArcTo);
    this.buf.f32(x1);
    this.buf.f32(y1);
    this.buf.f32(x2);
    this.buf.f32(y2);
    this.buf.f32(radius);
    this.lastX = x2;
    this.lastY = y2;
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
