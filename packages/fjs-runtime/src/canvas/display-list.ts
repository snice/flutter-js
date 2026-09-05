// Canvas display-list writer — the TypeScript twin of flutter_fjs's
// lib/src/canvas/canvas_ops.dart. Both files list the same command bytes in
// the same order and must move together; nothing generates one from the
// other, exactly like ui/ops.ts and ui_ops.dart.
//
// Why a binary stream of its own rather than a key inside SetProps:
//
//   * drawing is a STREAM, not a property. Two frames of commands append;
//     they do not replace one another, and there is nothing to diff. Putting
//     them in props would turn "what did this frame draw" into "what is in
//     that array right now".
//   * one ECharts frame is thousands of commands. JSON.stringify on the JS
//     side plus jsonDecode on the Dart side is precisely the serialization
//     cost this runtime exists to avoid (constitution III).
//
// Encoding notes:
//
//   * coordinates are f32. Canvas coordinates are logical pixels, where f32
//     carries far more precision than any screen resolves, and it halves the
//     argument-heavy commands (lineTo: 9 bytes instead of 17).
//   * strings are interned per CHUNK and referenced by u16. A chart frame
//     assigns the same handful of colour strings thousands of times, and a
//     per-chunk table keeps each chunk self-contained — which is what lets
//     the host drop older chunks without rewriting the ones it keeps.
//   * CLEAR_ALL always starts a chunk. The host truncates on it without
//     parsing; see canvas/display_list.dart for the retention model.
import { utf8Encode } from '../ui/utf8';

export const enum Cmd {
  StrDef = 0x01,

  Save = 0x10,
  Restore = 0x11,
  Transform = 0x12,
  SetTransform = 0x13,
  ResetTransform = 0x14,

  SetFillColor = 0x20,
  SetFillHandle = 0x21,
  SetStrokeColor = 0x22,
  SetStrokeHandle = 0x23,
  SetLineWidth = 0x24,
  SetLineCap = 0x25,
  SetLineJoin = 0x26,
  SetMiterLimit = 0x27,
  SetLineDash = 0x28,
  SetLineDashOffset = 0x29,
  SetGlobalAlpha = 0x2a,
  SetComposite = 0x2b,
  SetFont = 0x2c,
  SetTextAlign = 0x2d,
  SetTextBaseline = 0x2e,
  SetShadow = 0x2f,

  ClearRect = 0x30,
  FillRect = 0x31,
  StrokeRect = 0x32,
  FillPath = 0x33,
  StrokePath = 0x34,
  ClipPath = 0x35,
  FillText = 0x36,
  StrokeText = 0x37,
  DrawImage = 0x38,
  Reset = 0x39,
  ClearAll = 0x3a,

  DefLinearGradient = 0x40,
  DefRadialGradient = 0x41,
  DefPattern = 0x42,
}

/** Path sub-stream. A path travels with the command that uses it instead of
 * being retained on the host: the current path is JS-side state, and
 * re-sending it keeps the decoder stateless across chunks. The cost is one
 * duplicate path when a page fills AND strokes the same one. */
export const enum PathCmd {
  MoveTo = 1,
  LineTo = 2,
  CubicTo = 3,
  QuadTo = 4,
  Arc = 5,
  ArcTo = 6,
  Ellipse = 7,
  Rect = 8,
  Close = 9,
}

/** drawImage's argument forms, matching the DOM's overloads. */
export const enum DrawImageForm {
  DstPoint = 3,
  DstRect = 5,
  SrcDstRect = 9,
}

/** Growable little-endian byte buffer. Split out from the writer because
 * paths are encoded into their own buffer and then embedded length-prefixed. */
export class ByteBuf {
  private buf = new Uint8Array(1024);
  private len = 0;

  get length(): number {
    return this.len;
  }

  private ensure(n: number): void {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.len + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  u8(v: number): void {
    this.ensure(1);
    this.buf[this.len++] = v & 0xff;
  }

  u16(v: number): void {
    this.ensure(2);
    this.buf[this.len++] = v & 0xff;
    this.buf[this.len++] = (v >>> 8) & 0xff;
  }

  u32(v: number): void {
    this.ensure(4);
    const b = this.buf;
    let p = this.len;
    b[p++] = v & 0xff;
    b[p++] = (v >>> 8) & 0xff;
    b[p++] = (v >>> 16) & 0xff;
    b[p++] = (v >>> 24) & 0xff;
    this.len = p;
  }

  f32(v: number): void {
    this.ensure(4);
    f32View[0] = v;
    const b = this.buf;
    b[this.len++] = f32Bytes[0];
    b[this.len++] = f32Bytes[1];
    b[this.len++] = f32Bytes[2];
    b[this.len++] = f32Bytes[3];
  }

  bytes(src: Uint8Array): void {
    this.ensure(src.length);
    this.buf.set(src, this.len);
    this.len += src.length;
  }

  /** The bytes so far, leaving them in place. */
  peek(): Uint8Array {
    return this.buf.slice(0, this.len);
  }

  take(): Uint8Array {
    const out = this.buf.slice(0, this.len);
    this.len = 0;
    return out;
  }

  reset(): void {
    this.len = 0;
  }
}

// One shared scratch view: QuickJS has no cheap way to reinterpret a float,
// and allocating a DataView per coordinate would dominate the encoding cost.
const f32Scratch = new ArrayBuffer(4);
const f32View = new Float32Array(f32Scratch);
const f32Bytes = new Uint8Array(f32Scratch);

/** Writes one canvas node's command stream, split into chunks at CLEAR_ALL. */
export class CanvasWriter {
  private buf = new ByteBuf();
  /** Chunks completed but not yet handed to the op frame. */
  private pending: Uint8Array[] = [];
  /** Per-chunk string table. Cleared whenever a chunk is closed. */
  private strings = new Map<string, number>();
  private nextStringId = 1;

  constructor(private readonly onDirty: () => void) {}

  /** Interns a string in the current chunk, emitting its definition once. */
  str(value: string): number {
    const known = this.strings.get(value);
    if (known !== undefined) return known;
    const id = this.nextStringId++;
    this.strings.set(value, id);
    const encoded = utf8Encode(value);
    this.buf.u8(Cmd.StrDef);
    this.buf.u16(id);
    this.buf.u16(encoded.length);
    this.buf.bytes(encoded);
    return id;
  }

  /** Starts a command. Callers follow with the argument writers below. */
  cmd(c: Cmd): ByteBuf {
    this.buf.u8(c);
    this.onDirty();
    return this.buf;
  }

  /** Everything drawn so far is now invisible: close this chunk and open the
   * next one with the marker the host truncates on. */
  clearAll(): void {
    this.closeChunk();
    this.buf.u8(Cmd.ClearAll);
    this.onDirty();
  }

  private closeChunk(): void {
    if (this.buf.length > 0) this.pending.push(this.buf.take());
    this.strings.clear();
    this.nextStringId = 1;
  }

  /** Hands over the chunks to send, oldest first. */
  takeChunks(): Uint8Array[] {
    this.closeChunk();
    const out = this.pending;
    this.pending = [];
    return out;
  }

  get isEmpty(): boolean {
    return this.buf.length === 0 && this.pending.length === 0;
  }
}
