// The canvas surface as pages see it.
//
// This file is docs/canvas-compat.md in type form, and that is the point:
// it is deliberately NOT the DOM's lib.dom.d.ts shapes, so a page that
// reaches for something the Flutter side cannot do — getImageData, filter,
// roundRect — is told at build time rather than by comparing screenshots
// with a browser. The web build has the browser's own context behind these
// types; the extra methods it happens to have stay out of reach on purpose
// (constitution I).
//
// Types only: the implementations are context-2d.ts (Flutter) and the
// browser's own (web).

/** The 2D context, as fjs implements it on BOTH platforms.
 *
 * Deliberately not the DOM's `CanvasRenderingContext2D`: this interface IS
 * the compatibility list (docs/canvas-compat.md) expressed in types, so a
 * page that reaches for something the Flutter side cannot do — getImageData,
 * filter, roundRect — is told at build time instead of finding out by
 * comparing screenshots. The web build has the browser's own context behind
 * this type; the extra methods it happens to have stay out of reach on
 * purpose (constitution I).
 */
export interface FjsCanvasContext2D {
  readonly canvas: unknown;

  save(): void;
  restore(): void;
  reset(): void;

  scale(x: number, y: number): void;
  rotate(angle: number): void;
  translate(x: number, y: number): void;
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  resetTransform(): void;
  getTransform(): { a: number; b: number; c: number; d: number; e: number; f: number };

  fillStyle: string | FjsCanvasGradient | FjsCanvasPattern;
  strokeStyle: string | FjsCanvasGradient | FjsCanvasPattern;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  miterLimit: number;
  lineDashOffset: number;
  globalAlpha: number;
  globalCompositeOperation: string;
  font: string;
  textAlign: string;
  textBaseline: string;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  setLineDash(segments: readonly number[]): void;
  getLineDash(): number[];

  createLinearGradient(x0: number, y0: number, x1: number, y1: number): FjsCanvasGradient;
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): FjsCanvasGradient;
  createPattern(image: FjsCanvasImageSource, repetition: string | null): FjsCanvasPattern | null;

  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void;
  quadraticCurveTo(x1: number, y1: number, x: number, y: number): void;
  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void;
  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void;
  rect(x: number, y: number, w: number, h: number): void;

  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  fill(fillRule?: string): void;
  stroke(): void;
  clip(fillRule?: string): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  strokeText(text: string, x: number, y: number, maxWidth?: number): void;
  measureText(text: string): FjsCanvasTextMetrics;
  drawImage(image: FjsCanvasImageSource, ...args: number[]): void;
}

/** What measureText gives back. `width` is always there; the bounding-box
 * fields are present when the host could produce them — a library that
 * feature-detects them (ECharts does) takes its own fallback path rather
 * than trusting a fabricated zero. */
export interface FjsCanvasTextMetrics {
  width: number;
  actualBoundingBoxAscent?: number;
  actualBoundingBoxDescent?: number;
  actualBoundingBoxLeft?: number;
  actualBoundingBoxRight?: number;
  fontBoundingBoxAscent?: number;
  fontBoundingBoxDescent?: number;
}

export interface FjsCanvasGradient {
  addColorStop(offset: number, color: string): void;
}

export interface FjsCanvasPattern {
  readonly handle?: number;
}

/** An image loaded through `loadCanvasImage()` (or, on web, anything the
 * browser accepts). Not `HTMLImageElement`: there is no DOM on Flutter. */
export interface FjsCanvasImageSource {
  readonly width: number;
  readonly height: number;
}

/** The members `ref` gives you on a `<canvas>`. Same three on both
 * platforms — see docs/ui-api.md. */
export interface FjsCanvasApi {
  getContext(type: '2d', attributes?: unknown): FjsCanvasContext2D | null;
  getContext(type: string, attributes?: unknown): unknown;
  /** Exports the whole canvas as a data URL. A promise on both platforms:
   * on Flutter the pixels do not exist until the host has painted. */
  toDataURL(type?: string, quality?: number): Promise<string>;
  /** Laid-out size in LOGICAL pixels — not a bitmap size, and not writable.
   * The host owns device pixels, so a page never scales for dpr. */
  readonly width: number;
  readonly height: number;
  /** What the surface has already scaled the backing store by: 1 on
   * Flutter, the browser's ratio on web. A page never needs this; a library
   * that takes over the whole canvas and resets the context transform
   * (zrender does) has to re-apply it. */
  readonly devicePixelRatio: number;
}
