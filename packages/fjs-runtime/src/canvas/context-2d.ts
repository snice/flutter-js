// CanvasRenderingContext2D, implemented in JS on top of the display list.
//
// The whole 2D state machine lives here rather than on the host
// (constitution VII): save/restore stacking, the current path, the current
// transform, the property values and their defaults are all information JS
// already has, and keeping them here means the host only ever executes
// resolved drawing commands. What the host does is the part JS cannot do at
// all: turn those commands into pixels.
//
// Two consequences worth knowing:
//
//   * property assignments are DEDUPED. `ctx.fillStyle = '#fff'` in a loop
//     emits one command, not one per iteration. A chart library sets the
//     style before every shape whether or not it changed, so this removes
//     most of the state traffic for free.
//   * the transform is tracked here as well as replayed there, because
//     clearRect has to know whether it covers the whole canvas (see
//     `clearRect`), and because a page can ask for `getTransform()`.
import { drawableText } from '../ui/drawable-text';
import { Cmd, DrawImageForm, type CanvasWriter } from './display-list';
import {
  DEFAULT_FONT,
  parseFontOrWarn,
  type FjsCanvasFont,
} from './font';
import { FjsCanvasImage } from './image';
import { measureTextOnHost, type FjsTextMetrics } from './measure';
import {
  FjsCanvasGradient,
  FjsCanvasPattern,
  patternRepeat,
} from './paint-style';
import { FjsPath2D } from './path2d';
// implemented against the page-facing interface on purpose: if this class
// stops satisfying it, the compat list and the implementation have drifted
import type { FjsCanvasContext2D } from './types';
import { warnCanvasOnce } from './warn';

export type FjsCanvasStyle = string | FjsCanvasGradient | FjsCanvasPattern;

/** What the context needs from whatever owns the canvas. Keeps this file
 * free of any element/DOM assumption, so the same context could be driven by
 * a different node layer. */
export interface CanvasSurface {
  readonly nodeId: number;
  readonly writer: CanvasWriter;
  /** Current logical size; 0 before the host has laid the box out. */
  width(): number;
  height(): number;
}

const LINE_CAP = { butt: 0, round: 1, square: 2 } as const;
const LINE_JOIN = { miter: 0, round: 1, bevel: 2 } as const;
const TEXT_ALIGN = { start: 0, end: 1, left: 2, right: 3, center: 4 } as const;
const TEXT_BASELINE = {
  top: 0,
  hanging: 1,
  middle: 2,
  alphabetic: 3,
  ideographic: 4,
  bottom: 5,
} as const;

/** Every composite operation the DOM defines, in the order Flutter's
 * BlendMode names them. All of them map, but the destination-* and copy
 * modes act on the layer rather than on the drawing alone, which is why the
 * host wraps a non-default mode in a saveLayer (see replay.dart). */
const COMPOSITE: Record<string, number> = {
  'source-over': 0,
  'source-in': 1,
  'source-out': 2,
  'source-atop': 3,
  'destination-over': 4,
  'destination-in': 5,
  'destination-out': 6,
  'destination-atop': 7,
  lighter: 8,
  copy: 9,
  xor: 10,
  multiply: 11,
  screen: 12,
  overlay: 13,
  darken: 14,
  lighten: 15,
  'color-dodge': 16,
  'color-burn': 17,
  'hard-light': 18,
  'soft-light': 19,
  difference: 20,
  exclusion: 21,
  hue: 22,
  saturation: 23,
  color: 24,
  luminosity: 25,
};

interface State {
  fillStyle: FjsCanvasStyle;
  strokeStyle: FjsCanvasStyle;
  lineWidth: number;
  lineCap: keyof typeof LINE_CAP;
  lineJoin: keyof typeof LINE_JOIN;
  miterLimit: number;
  lineDash: number[];
  lineDashOffset: number;
  globalAlpha: number;
  globalCompositeOperation: string;
  font: FjsCanvasFont;
  fontSource: string;
  textAlign: keyof typeof TEXT_ALIGN;
  textBaseline: keyof typeof TEXT_BASELINE;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  /** a b c d e f, the current transform. */
  matrix: number[];
}

function initialState(): State {
  return {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    miterLimit: 10,
    lineDash: [],
    lineDashOffset: 0,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    font: DEFAULT_FONT,
    fontSource: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    shadowColor: 'rgba(0, 0, 0, 0)',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    matrix: [1, 0, 0, 1, 0, 0],
  };
}

function multiply(m: number[], n: number[]): number[] {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export class FjsCanvasRenderingContext2D implements FjsCanvasContext2D {
  /** The element this context draws into. Pages and libraries read
   * `ctx.canvas.width`, so it is part of the contract, not a convenience. */
  readonly canvas: unknown;

  private readonly surface: CanvasSurface;
  private state = initialState();
  private readonly stack: State[] = [];
  /** What the host currently has. Only differences are sent. */
  private sent = initialState();
  private path = new FjsPath2D();

  constructor(surface: CanvasSurface, canvas: unknown) {
    this.surface = surface;
    this.canvas = canvas;
  }

  // ---- state -------------------------------------------------------------

  save(): void {
    this.stack.push({ ...this.state, lineDash: [...this.state.lineDash], matrix: [...this.state.matrix] });
    this.surface.writer.cmd(Cmd.Save);
    // the host's own stack now holds a copy of what it currently has, so the
    // dedup baseline has to be stacked with it
    this.sentStack.push({ ...this.sent, lineDash: [...this.sent.lineDash], matrix: [...this.sent.matrix] });
  }

  private readonly sentStack: State[] = [];

  restore(): void {
    const previous = this.stack.pop();
    if (!previous) return;
    this.state = previous;
    this.surface.writer.cmd(Cmd.Restore);
    const sent = this.sentStack.pop();
    if (sent) this.sent = sent;
  }

  reset(): void {
    this.state = initialState();
    this.stack.length = 0;
    this.path = new FjsPath2D();
    this.surface.writer.clearAll();
    this.afterChunkBoundary();
  }

  /** A CLEAR_ALL opens a new chunk and lets the host drop every chunk before
   * it — including the commands that put the host in its current state. So a
   * chunk has to be self-contained in STATE as well as in strings: the
   * dedup baseline goes back to the defaults the host starts a chunk from,
   * and every property the page has set will be re-sent before the next
   * draw that needs it.
   *
   * Getting this wrong is invisible until it isn't: a chart that sets its
   * colours once and then clears every frame would paint the first frame
   * correctly and every later one in black. */
  private afterChunkBoundary(): void {
    this.sent = initialState();
    this.sentStack.length = 0;
    // the host's own save stack went with the dropped chunks; re-open one
    // level per level the page currently holds, so a later restore() still
    // has something to pop
    for (let i = 0; i < this.stack.length; i++) {
      this.surface.writer.cmd(Cmd.Save);
      this.sentStack.push(initialState());
    }
    // the transform went too: the host starts a chunk at identity
    const m = this.state.matrix;
    if (m[0] !== 1 || m[1] !== 0 || m[2] !== 0 || m[3] !== 1 || m[4] !== 0 || m[5] !== 0) {
      const buf = this.surface.writer.cmd(Cmd.SetTransform);
      for (let i = 0; i < 6; i++) buf.f32(m[i]);
    }
  }

  // ---- transforms --------------------------------------------------------

  scale(x: number, y: number): void {
    this.transform(x, 0, 0, y, 0, 0);
  }

  rotate(angle: number): void {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    this.transform(cos, sin, -sin, cos, 0, 0);
  }

  translate(x: number, y: number): void {
    this.transform(1, 0, 0, 1, x, y);
  }

  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.state.matrix = multiply(this.state.matrix, [a, b, c, d, e, f]);
    const buf = this.surface.writer.cmd(Cmd.Transform);
    buf.f32(a);
    buf.f32(b);
    buf.f32(c);
    buf.f32(d);
    buf.f32(e);
    buf.f32(f);
  }

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.state.matrix = [a, b, c, d, e, f];
    const buf = this.surface.writer.cmd(Cmd.SetTransform);
    buf.f32(a);
    buf.f32(b);
    buf.f32(c);
    buf.f32(d);
    buf.f32(e);
    buf.f32(f);
  }

  resetTransform(): void {
    this.state.matrix = [1, 0, 0, 1, 0, 0];
    this.surface.writer.cmd(Cmd.ResetTransform);
  }

  getTransform(): { a: number; b: number; c: number; d: number; e: number; f: number } {
    const [a, b, c, d, e, f] = this.state.matrix;
    return { a, b, c, d, e, f };
  }

  // ---- style properties --------------------------------------------------

  get fillStyle(): FjsCanvasStyle {
    return this.state.fillStyle;
  }

  set fillStyle(value: FjsCanvasStyle) {
    this.state.fillStyle = value;
  }

  get strokeStyle(): FjsCanvasStyle {
    return this.state.strokeStyle;
  }

  set strokeStyle(value: FjsCanvasStyle) {
    this.state.strokeStyle = value;
  }

  get lineWidth(): number {
    return this.state.lineWidth;
  }

  set lineWidth(value: number) {
    if (Number.isFinite(value) && value > 0) this.state.lineWidth = value;
  }

  get lineCap(): string {
    return this.state.lineCap;
  }

  set lineCap(value: string) {
    if (value in LINE_CAP) this.state.lineCap = value as keyof typeof LINE_CAP;
  }

  get lineJoin(): string {
    return this.state.lineJoin;
  }

  set lineJoin(value: string) {
    if (value in LINE_JOIN) this.state.lineJoin = value as keyof typeof LINE_JOIN;
  }

  get miterLimit(): number {
    return this.state.miterLimit;
  }

  set miterLimit(value: number) {
    if (Number.isFinite(value) && value > 0) this.state.miterLimit = value;
  }

  setLineDash(segments: readonly number[]): void {
    const clean = segments.filter((n) => Number.isFinite(n) && n >= 0);
    // odd lists are doubled, per the spec
    this.state.lineDash = clean.length % 2 === 1 ? [...clean, ...clean] : clean;
  }

  getLineDash(): number[] {
    return [...this.state.lineDash];
  }

  get lineDashOffset(): number {
    return this.state.lineDashOffset;
  }

  set lineDashOffset(value: number) {
    if (Number.isFinite(value)) this.state.lineDashOffset = value;
  }

  get globalAlpha(): number {
    return this.state.globalAlpha;
  }

  set globalAlpha(value: number) {
    if (Number.isFinite(value) && value >= 0 && value <= 1) {
      this.state.globalAlpha = value;
    }
  }

  get globalCompositeOperation(): string {
    return this.state.globalCompositeOperation;
  }

  set globalCompositeOperation(value: string) {
    if (value in COMPOSITE) {
      this.state.globalCompositeOperation = value;
      return;
    }
    warnCanvasOnce(
      `composite:${value}`,
      `globalCompositeOperation "${value}" is not supported; keeping ` +
        `"${this.state.globalCompositeOperation}".`,
    );
  }

  get font(): string {
    return this.state.fontSource;
  }

  set font(value: string) {
    const parsed = parseFontOrWarn(value, this.state.font);
    this.state.font = parsed;
    this.state.fontSource = value;
  }

  get textAlign(): string {
    return this.state.textAlign;
  }

  set textAlign(value: string) {
    if (value in TEXT_ALIGN) this.state.textAlign = value as keyof typeof TEXT_ALIGN;
  }

  get textBaseline(): string {
    return this.state.textBaseline;
  }

  set textBaseline(value: string) {
    if (value in TEXT_BASELINE) {
      this.state.textBaseline = value as keyof typeof TEXT_BASELINE;
    }
  }

  get shadowColor(): string {
    return this.state.shadowColor;
  }

  set shadowColor(value: string) {
    this.state.shadowColor = value;
  }

  get shadowBlur(): number {
    return this.state.shadowBlur;
  }

  set shadowBlur(value: number) {
    if (Number.isFinite(value) && value >= 0) this.state.shadowBlur = value;
  }

  get shadowOffsetX(): number {
    return this.state.shadowOffsetX;
  }

  set shadowOffsetX(value: number) {
    if (Number.isFinite(value)) this.state.shadowOffsetX = value;
  }

  get shadowOffsetY(): number {
    return this.state.shadowOffsetY;
  }

  set shadowOffsetY(value: number) {
    if (Number.isFinite(value)) this.state.shadowOffsetY = value;
  }

  /** `filter` needs a CSS filter parser and a shader chain per value; out of
   * scope (spec §2). Warned rather than dropped so a page that relies on it
   * finds out here instead of by comparing screenshots. */
  set filter(value: string) {
    if (value === 'none' || value === '') return;
    warnCanvasOnce(
      'filter',
      'ctx.filter is not supported (see docs/canvas-compat.md).',
    );
  }

  get filter(): string {
    return 'none';
  }

  // ---- paint styles ------------------------------------------------------

  createLinearGradient(x0: number, y0: number, x1: number, y1: number): FjsCanvasGradient {
    return new FjsCanvasGradient(false, [x0, y0, x1, y1]);
  }

  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): FjsCanvasGradient {
    return new FjsCanvasGradient(true, [x0, y0, r0, x1, y1, r1]);
  }

  createPattern(image: FjsCanvasImage, repetition: string | null): FjsCanvasPattern | null {
    if (!(image instanceof FjsCanvasImage)) {
      warnCanvasOnce(
        'pattern-source',
        'createPattern() takes an image loaded through this canvas; other ' +
          'sources are not supported.',
      );
      return null;
    }
    return new FjsCanvasPattern(image.handle, patternRepeat(repetition));
  }

  // ---- paths -------------------------------------------------------------

  beginPath(): void {
    this.path = new FjsPath2D();
  }

  closePath(): void {
    this.path.closePath();
  }

  moveTo(x: number, y: number): void {
    this.path.moveTo(x, y);
  }

  lineTo(x: number, y: number): void {
    this.path.lineTo(x, y);
  }

  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void {
    this.path.bezierCurveTo(x1, y1, x2, y2, x, y);
  }

  quadraticCurveTo(x1: number, y1: number, x: number, y: number): void {
    this.path.quadraticCurveTo(x1, y1, x, y);
  }

  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void {
    this.path.arc(x, y, radius, startAngle, endAngle, counterclockwise);
  }

  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void {
    this.path.arcTo(x1, y1, x2, y2, radius);
  }

  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void {
    this.path.ellipse(x, y, radiusX, radiusY, rotation, startAngle, endAngle, counterclockwise);
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.path.rect(x, y, w, h);
  }

  roundRect(): void {
    this.path.roundRect();
  }

  // ---- drawing -----------------------------------------------------------

  clearRect(x: number, y: number, w: number, h: number): void {
    if (this.coversCanvas(x, y, w, h)) {
      // everything drawn so far is now invisible; tell the host it can drop
      // it instead of keeping commands it will paint under this rect forever
      this.surface.writer.clearAll();
      this.afterChunkBoundary();
      return;
    }
    const buf = this.surface.writer.cmd(Cmd.ClearRect);
    buf.f32(x);
    buf.f32(y);
    buf.f32(w);
    buf.f32(h);
  }

  /** True when this rect, under the current transform, covers the whole
   * canvas. Only the axis-aligned case is recognised: a rotated clear is
   * legal but nothing draws one, and being wrong here would drop commands
   * that are still visible. */
  private coversCanvas(x: number, y: number, w: number, h: number): boolean {
    const width = this.surface.width();
    const height = this.surface.height();
    if (width <= 0 || height <= 0) return false;
    const [a, b, c, d, e, f] = this.state.matrix;
    if (b !== 0 || c !== 0 || a <= 0 || d <= 0) return false;
    const left = a * x + e;
    const top = d * y + f;
    return left <= 0 && top <= 0 && left + a * w >= width && top + d * h >= height;
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.syncFill();
    const buf = this.surface.writer.cmd(Cmd.FillRect);
    buf.f32(x);
    buf.f32(y);
    buf.f32(w);
    buf.f32(h);
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    this.syncStroke();
    const buf = this.surface.writer.cmd(Cmd.StrokeRect);
    buf.f32(x);
    buf.f32(y);
    buf.f32(w);
    buf.f32(h);
  }

  fill(pathOrRule?: FjsPath2D | string, maybeRule?: string): void {
    const path = pathOrRule instanceof FjsPath2D ? pathOrRule : this.path;
    const rule = typeof pathOrRule === 'string' ? pathOrRule : maybeRule;
    if (path.isEmpty) return;
    this.syncFill();
    const bytes = path.snapshot();
    const buf = this.surface.writer.cmd(Cmd.FillPath);
    buf.u8(rule === 'evenodd' ? 1 : 0);
    buf.u32(bytes.length);
    buf.bytes(bytes);
  }

  stroke(path?: FjsPath2D): void {
    const target = path ?? this.path;
    if (target.isEmpty) return;
    this.syncStroke();
    const bytes = target.snapshot();
    const buf = this.surface.writer.cmd(Cmd.StrokePath);
    buf.u32(bytes.length);
    buf.bytes(bytes);
  }

  clip(pathOrRule?: FjsPath2D | string, maybeRule?: string): void {
    const path = pathOrRule instanceof FjsPath2D ? pathOrRule : this.path;
    const rule = typeof pathOrRule === 'string' ? pathOrRule : maybeRule;
    if (path.isEmpty) return;
    const bytes = path.snapshot();
    const buf = this.surface.writer.cmd(Cmd.ClipPath);
    buf.u8(rule === 'evenodd' ? 1 : 0);
    buf.u32(bytes.length);
    buf.bytes(bytes);
  }

  fillText(text: string, x: number, y: number, maxWidth?: number): void {
    this.drawText(Cmd.FillText, text, x, y, maxWidth, true);
  }

  strokeText(text: string, x: number, y: number, maxWidth?: number): void {
    this.drawText(Cmd.StrokeText, text, x, y, maxWidth, false);
  }

  private drawText(
    cmd: Cmd,
    rawText: string,
    x: number,
    y: number,
    maxWidth: number | undefined,
    fill: boolean,
  ): void {
    const text = drawableText(rawText);
    if (text === '') return;
    if (fill) this.syncFill();
    else this.syncStroke();
    this.syncText();
    const id = this.surface.writer.str(text);
    const buf = this.surface.writer.cmd(cmd);
    buf.u16(id);
    buf.f32(x);
    buf.f32(y);
    buf.u8(maxWidth === undefined ? 0 : 1);
    buf.f32(maxWidth ?? 0);
  }

  measureText(text: string): FjsTextMetrics {
    // measured on the same string that would be drawn, or a label would be
    // laid out against a width it never occupies
    return measureTextOnHost(this.state.font, drawableText(text));
  }

  drawImage(image: FjsCanvasImage, ...args: number[]): void {
    if (!(image instanceof FjsCanvasImage)) {
      warnCanvasOnce(
        'drawimage-source',
        'drawImage() takes an image loaded through this canvas; other ' +
          'sources (a second canvas, a video) are not supported.',
      );
      return;
    }
    const form =
      args.length >= 8
        ? DrawImageForm.SrcDstRect
        : args.length >= 4
          ? DrawImageForm.DstRect
          : DrawImageForm.DstPoint;
    this.syncCommon();
    const buf = this.surface.writer.cmd(Cmd.DrawImage);
    buf.u32(image.handle);
    buf.u8(form);
    const count = form === DrawImageForm.SrcDstRect ? 8 : form === DrawImageForm.DstRect ? 4 : 2;
    for (let i = 0; i < count; i++) buf.f32(args[i] ?? 0);
  }

  /** Pixel read-back. `toDataURL` on the element is the supported export
   * path; these need the bitmap in JS, which the boundary does not carry
   * (spec §7.1). */
  getImageData(): null {
    warnCanvasOnce(
      'getImageData',
      'getImageData() is not supported; use canvas.toDataURL() to export ' +
        'the whole canvas (see docs/canvas-compat.md).',
    );
    return null;
  }

  putImageData(): void {
    warnCanvasOnce(
      'putImageData',
      'putImageData() is not supported (see docs/canvas-compat.md).',
    );
  }

  createImageData(): null {
    warnCanvasOnce(
      'createImageData',
      'createImageData() is not supported (see docs/canvas-compat.md).',
    );
    return null;
  }

  isPointInPath(): boolean {
    warnCanvasOnce(
      'isPointInPath',
      'isPointInPath() is not supported; hit-test in page code against the ' +
        'geometry you drew (see docs/canvas-compat.md).',
    );
    return false;
  }

  isPointInStroke(): boolean {
    warnCanvasOnce(
      'isPointInStroke',
      'isPointInStroke() is not supported (see docs/canvas-compat.md).',
    );
    return false;
  }

  // ---- state synchronisation --------------------------------------------
  //
  // Sent lazily, just before a draw, and only for what changed. A chart sets
  // the same fillStyle before every one of a thousand bars; sending on
  // assignment would put a thousand redundant commands in the frame.

  private syncCommon(): void {
    const state = this.state;
    const sent = this.sent;
    if (state.globalAlpha !== sent.globalAlpha) {
      this.surface.writer.cmd(Cmd.SetGlobalAlpha).f32(state.globalAlpha);
      sent.globalAlpha = state.globalAlpha;
    }
    if (state.globalCompositeOperation !== sent.globalCompositeOperation) {
      this.surface.writer
        .cmd(Cmd.SetComposite)
        .u8(COMPOSITE[state.globalCompositeOperation] ?? 0);
      sent.globalCompositeOperation = state.globalCompositeOperation;
    }
    const shadowChanged =
      state.shadowColor !== sent.shadowColor ||
      state.shadowBlur !== sent.shadowBlur ||
      state.shadowOffsetX !== sent.shadowOffsetX ||
      state.shadowOffsetY !== sent.shadowOffsetY;
    if (shadowChanged) {
      const id = this.surface.writer.str(state.shadowColor);
      const buf = this.surface.writer.cmd(Cmd.SetShadow);
      buf.u16(id);
      buf.f32(state.shadowBlur);
      buf.f32(state.shadowOffsetX);
      buf.f32(state.shadowOffsetY);
      sent.shadowColor = state.shadowColor;
      sent.shadowBlur = state.shadowBlur;
      sent.shadowOffsetX = state.shadowOffsetX;
      sent.shadowOffsetY = state.shadowOffsetY;
    }
  }

  private syncFill(): void {
    this.syncCommon();
    if (this.state.fillStyle === this.sent.fillStyle) return;
    this.writeStyle(this.state.fillStyle, Cmd.SetFillColor, Cmd.SetFillHandle);
    this.sent.fillStyle = this.state.fillStyle;
  }

  private syncStroke(): void {
    this.syncCommon();
    const state = this.state;
    const sent = this.sent;
    if (state.strokeStyle !== sent.strokeStyle) {
      this.writeStyle(state.strokeStyle, Cmd.SetStrokeColor, Cmd.SetStrokeHandle);
      sent.strokeStyle = state.strokeStyle;
    }
    if (state.lineWidth !== sent.lineWidth) {
      this.surface.writer.cmd(Cmd.SetLineWidth).f32(state.lineWidth);
      sent.lineWidth = state.lineWidth;
    }
    if (state.lineCap !== sent.lineCap) {
      this.surface.writer.cmd(Cmd.SetLineCap).u8(LINE_CAP[state.lineCap]);
      sent.lineCap = state.lineCap;
    }
    if (state.lineJoin !== sent.lineJoin) {
      this.surface.writer.cmd(Cmd.SetLineJoin).u8(LINE_JOIN[state.lineJoin]);
      sent.lineJoin = state.lineJoin;
    }
    if (state.miterLimit !== sent.miterLimit) {
      this.surface.writer.cmd(Cmd.SetMiterLimit).f32(state.miterLimit);
      sent.miterLimit = state.miterLimit;
    }
    if (!sameDash(state.lineDash, sent.lineDash)) {
      const buf = this.surface.writer.cmd(Cmd.SetLineDash);
      const count = Math.min(state.lineDash.length, 255);
      buf.u8(count);
      for (let i = 0; i < count; i++) buf.f32(state.lineDash[i]);
      sent.lineDash = [...state.lineDash];
    }
    if (state.lineDashOffset !== sent.lineDashOffset) {
      this.surface.writer.cmd(Cmd.SetLineDashOffset).f32(state.lineDashOffset);
      sent.lineDashOffset = state.lineDashOffset;
    }
  }

  private syncText(): void {
    const state = this.state;
    const sent = this.sent;
    if (state.fontSource !== sent.fontSource) {
      const id = this.surface.writer.str(state.font.family);
      const buf = this.surface.writer.cmd(Cmd.SetFont);
      buf.u16(id);
      buf.f32(state.font.size);
      buf.u16(state.font.weight);
      buf.u8(state.font.italic ? 1 : 0);
      sent.fontSource = state.fontSource;
      sent.font = state.font;
    }
    if (state.textAlign !== sent.textAlign) {
      this.surface.writer.cmd(Cmd.SetTextAlign).u8(TEXT_ALIGN[state.textAlign]);
      sent.textAlign = state.textAlign;
    }
    if (state.textBaseline !== sent.textBaseline) {
      this.surface.writer
        .cmd(Cmd.SetTextBaseline)
        .u8(TEXT_BASELINE[state.textBaseline]);
      sent.textBaseline = state.textBaseline;
    }
  }

  private writeStyle(style: FjsCanvasStyle, colorCmd: Cmd, handleCmd: Cmd): void {
    if (typeof style === 'string') {
      const id = this.surface.writer.str(style);
      this.surface.writer.cmd(colorCmd).u16(id);
      return;
    }
    style.define(this.surface.writer);
    this.surface.writer.cmd(handleCmd).u32(style.handle);
  }
}

function sameDash(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
