// Binary UI op writer — the TypeScript twin of flutter_fjs's
// lib/src/ui_ops.dart decoder (and of the dump in native/tools/fjsrun.cpp;
// all three switch on the same opcodes and must move together).
// One flush() = one frame = one call into native __fjs.fns.uiOps(Uint8Array).
// Little-endian throughout.
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
  DefineStyle = 7,
  SetStyle = 8,
  ResetStyles = 9,
}

/** How many interned styles the peer is asked to remember at once. The style
 * engine's own compute cache is capped at 4096 distinct results, so a smaller
 * table here only costs the occasional re-send. Overflow is handled by ending
 * the epoch (ResetStyles), never by dropping individual entries: ids are
 * resolved at decode time and the peer holds the resolved style directly, so
 * an entry leaving the table cannot dangle. */
const STYLE_TABLE_MAX = 2048;

/** Op protocol revision the host's decoder implements; interned styles need
 * 2. The host sets `globalThis.__fjsHost` when it creates the VM. A missing
 * value means an older host that only knows ops 1-6 — a bundle built against
 * this runtime can meet one, since bundles ship separately from the Flutter
 * binary. */
function hostUiOpsVersion(): number {
  const declared = (globalThis as { __fjsHost?: { uiOpsVersion?: number } })
    .__fjsHost?.uiOpsVersion;
  return typeof declared === 'number' ? declared : 1;
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

  /** Style assignment for a computed style map. The style engine hands the
   * same (immutable) object to every element with an identical computed
   * style, so the map itself crosses the bridge ONCE per frame (DefineStyle)
   * and each element only references it by id (SetStyle, 13 bytes).
   *
   * Both slots are replace, not merge: passing no `activeStyle` clears the
   * pressed variant the peer is holding. That matches the only caller — the
   * renderer's applyStyle only omits it for elements that never matched an
   * `:active` rule.
   */
  setStyle(
    id: number,
    style: Record<string, unknown>,
    activeStyle?: Record<string, unknown> | null,
  ): this {
    if (this.uiOpsVersion < 2) return this.setStyleAsProps(id, style, activeStyle);
    const sid = this.styleId(style);
    const aid = activeStyle ? this.styleId(activeStyle) : 0;
    this.u8(UiOp.SetStyle);
    this.u32(id);
    this.u32(sid);
    this.u32(aid);
    return this;
  }

  /** Interns a style object, emitting its definition the first time the peer
   * needs to know it. Ids come off object identity, so two elements that the
   * style engine collapsed onto one computed style share an id for free. */
  private styleId(style: Record<string, unknown>): number {
    let id = this.styleIds.get(style);
    if (id === undefined) {
      id = this.nextStyleId++;
      this.styleIds.set(style, id);
    }
    if (!this.defined.has(id)) {
      if (this.defined.size >= STYLE_TABLE_MAX) {
        // end the epoch rather than evicting one entry: ops are ordered, so
        // every SetStyle after this is preceded by a fresh DefineStyle
        this.u8(UiOp.ResetStyles);
        this.defined.clear();
      }
      const json = utf8Encode(JSON.stringify(style));
      this.u8(UiOp.DefineStyle);
      this.u32(id);
      this.u32(json.length);
      this.bytes(json);
      this.defined.add(id);
    }
    return id;
  }

  /** Pre-interning encoding: the whole style map inlined into a SetProps for
   * every element. Only reachable against a host too old to decode ops 7-9. */
  private setStyleAsProps(
    id: number,
    style: Record<string, unknown>,
    activeStyle?: Record<string, unknown> | null,
  ): this {
    if (activeStyle !== undefined) {
      return this.writeProps(
        id,
        utf8Encode(JSON.stringify({ style, activeStyle })),
      );
    }
    let json = this.legacyStyleJson.get(style);
    if (json === undefined) {
      json = utf8Encode(JSON.stringify({ style }));
      this.legacyStyleJson.set(style, json);
    }
    return this.writeProps(id, json);
  }

  private legacyStyleJson = new WeakMap<object, Uint8Array>();
  private cachedUiOpsVersion = 0;

  /** Read on first use, not at construction: this writer is a module
   * singleton created when host.ts evaluates, and a test or an offline
   * runner may install `__fjsHost` after that. Cached once resolved. */
  private get uiOpsVersion(): number {
    return this.cachedUiOpsVersion ||
      (this.cachedUiOpsVersion = hostUiOpsVersion());
  }

  /** Object identity -> id. A WeakMap so a style the engine has dropped stops
   * pinning its id; `nextStyleId` never rewinds, which keeps a misordered or
   * truncated frame diagnosable instead of silently aliasing two styles. */
  private styleIds = new WeakMap<object, number>();
  /** Ids the peer currently holds definitions for. */
  private defined = new Set<number>();
  private nextStyleId = 1;

  /** Drops the peer's style directory, so the next use of every style
   * re-sends its definition. The host calls this when it starts recording
   * frames: a frame log has to be self-contained, and definitions emitted
   * before recording began are not in it.
   */
  forgetStyles(): void {
    if (this.defined.size === 0) return;
    this.defined.clear();
    this.u8(UiOp.ResetStyles);
  }

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
