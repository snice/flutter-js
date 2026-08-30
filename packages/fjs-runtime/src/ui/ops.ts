// Binary UI op writer — the TypeScript twin of flutter_jsc's
// lib/src/ui_ops.dart decoder. One flush() = one frame = one call into
// native __fjs.fns.uiOps(Uint8Array). Little-endian throughout.
// Writes go into a single growable byte buffer (per-byte array pushes are
// the dominant mount cost under QuickJS).
import { utf8Encode } from './utf8';

export const enum UiOp {
  Create = 1,
  Remove = 2,
  Insert = 3,
  RemoveChild = 4,
  SetText = 5,
  SetProps = 6,
}

export class OpWriter {
  private buf = new Uint8Array(8192);
  private len = 0;

  private ensure(n: number): void {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.len + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  private u8(v: number): void {
    this.ensure(1);
    this.buf[this.len++] = v & 0xff;
  }

  private u32(v: number): void {
    this.ensure(4);
    const b = this.buf;
    let p = this.len;
    b[p++] = (v >>> 0) & 0xff;
    b[p++] = ((v >>> 8) & 0xff) as number;
    b[p++] = ((v >>> 16) & 0xff) as number;
    b[p++] = ((v >>> 24) & 0xff) as number;
    this.len = p;
  }

  private u16(v: number): void {
    this.ensure(2);
    const b = this.buf;
    let p = this.len;
    b[p++] = (v >>> 0) & 0xff;
    b[p++] = ((v >>> 8) & 0xff) as number;
    this.len = p;
  }

  private bytes(b: Uint8Array): void {
    this.ensure(b.length);
    this.buf.set(b, this.len);
    this.len += b.length;
  }

  private utf8(s: string): void {
    this.bytes(utf8Encode(s));
  }

  create(id: number, tag: string): this {
    this.u8(UiOp.Create);
    this.u32(id);
    const encoded = utf8Encode(tag);
    this.u16(encoded.length);
    this.bytes(encoded);
    return this;
  }

  remove(id: number): this {
    this.u8(UiOp.Remove);
    this.u32(id);
    return this;
  }

  insert(parent: number, child: number, index: number): this {
    this.u8(UiOp.Insert);
    this.u32(parent);
    this.u32(child);
    this.u32(index);
    return this;
  }

  removeChild(parent: number, child: number): this {
    this.u8(UiOp.RemoveChild);
    this.u32(parent);
    this.u32(child);
    return this;
  }

  setText(id: number, text: string): this {
    const encoded = utf8Encode(text);
    this.u8(UiOp.SetText);
    this.u32(id);
    this.u32(encoded.length);
    this.bytes(encoded);
    return this;
  }

  setProps(id: number, props: Record<string, unknown>): this {
    return this.writeProps(id, utf8Encode(JSON.stringify(props)));
  }

  /** setProps for a computed style map. The style engine hands the same
   * (immutable) object to every element with an identical computed style,
   * so a mount of N similar rows serializes it once instead of N times. */
  setStyle(
    id: number,
    style: Record<string, unknown>,
    activeStyle?: Record<string, unknown> | null,
  ): this {
    // the cached form is keyed on the style object, so an element that also
    // carries a pressed variant serializes on its own
    if (activeStyle !== undefined) {
      return this.writeProps(
        id,
        utf8Encode(JSON.stringify({ style, activeStyle })),
      );
    }
    let json = this.styleJson.get(style);
    if (json === undefined) {
      json = utf8Encode(JSON.stringify({ style }));
      this.styleJson.set(style, json);
    }
    return this.writeProps(id, json);
  }

  private styleJson = new WeakMap<object, Uint8Array>();

  private writeProps(id: number, json: Uint8Array): this {
    this.u8(UiOp.SetProps);
    this.u32(id);
    this.u32(json.length);
    this.bytes(json);
    return this;
  }

  get isEmpty(): boolean {
    return this.len === 0;
  }

  reset(): void {
    this.len = 0;
  }

  toUint8Array(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}
