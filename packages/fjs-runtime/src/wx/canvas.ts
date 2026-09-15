// <canvas> on wx: the fjs canvas contract (docs/canvas-compat.md) over the
// mini program's own `type="2d"` canvas node.
//
// Three pieces the other two ends get from their canvas component:
//
//   1. THE REF. `ref="cv"` on a canvas gives the page an FjsCanvasApi. There
//      is no vdom here to fill template refs, so the compiler stamps the node
//      with `id="fjs-cv-<ref>"` and lists the refs on the SFC (__fjsCanvas);
//      after the first render the node is looked up with a SelectorQuery and
//      the setup ref is assigned.
//   2. THE SIZE. `@resize` fires with the same `{"width","height"}` JSON the
//      other ends send, once the node is measured and again on a window
//      resize. The backing store follows the box (layout size x pixelRatio)
//      with a matching transform, so page coordinates are logical pixels —
//      the same rule the web surface applies.
//   3. IMAGES. A wx image comes from `canvas.createImage()`, so it belongs to
//      a canvas node that usually does not exist yet when the page calls
//      loadCanvasImage (setup runs before the first render). The handle
//      waits for the first live canvas, loads there, and resolves to a
//      per-node image inside drawImage / createPattern — an image created by
//      one node is not guaranteed to draw on another.
//
// WebGL is the node's own context too: a page that imports @ufjs/webgl gets
// `type="webgl"` canvases from the compiler (a wx node's type fixes its
// context family), and getContext('webgl' / 'webgl2') hands the wx context
// through, with texImage2D taking the same image handles.
import { markRaw, isRef, type Ref } from '@vue/reactivity';
import { resolveImageSrc } from '../image/src';

/** Compiler-injected (`__sfc__.__fjsCanvas`): one entry per canvas ref. */
export interface WxCanvasRef {
  ref: string;
  /** the element binds @resize */
  resize?: boolean;
}

interface WxImage {
  src: string;
  width: number;
  height: number;
  onload: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
}

interface WxCanvasNode {
  width: number;
  height: number;
  getContext(type: string): unknown;
  createImage(): WxImage;
  toDataURL?(type?: string, quality?: number): string;
}

type Ctx2D = Record<string, unknown> & {
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
};

interface Host {
  createSelectorQuery(): {
    select(sel: string): {
      fields(
        opts: Record<string, boolean>,
        cb?: (res: unknown) => void,
      ): { exec(cb?: (res: unknown[]) => void): void };
    };
    exec(cb?: (res: unknown[]) => void): void;
  };
  [key: string]: unknown;
}

// ---- images -----------------------------------------------------------------

const liveNodes = new Set<WxCanvasNode>();
const waitingImages = new Set<WxCanvasImage>();

/** The handle `loadCanvasImage` returns on wx. Same DOM-ish members as the
 * App handle (canvas/image.ts): src, width, height, complete, onload/onerror. */
export class WxCanvasImage {
  width = 0;
  height = 0;
  complete = false;
  onload: (() => void) | null = null;
  onerror: ((message: string) => void) | null = null;

  private _src = '';
  private _resolved = '';
  private readonly _perNode = new WeakMap<WxCanvasNode, WxImage>();
  private readonly _ready = new WeakSet<WxCanvasNode>();

  get src(): string {
    return this._src;
  }

  set src(value: string) {
    this._src = value;
    this._resolved = value ? resolveImageSrc(value) : '';
    this.complete = false;
    if (!value) return;
    const node = liveNodes.values().next().value as WxCanvasNode | undefined;
    if (node) this._load(node, true);
    else waitingImages.add(this);
  }

  /** @internal — a canvas became available for a waiting image. */
  _loadOn(node: WxCanvasNode): void {
    this._load(node, true);
  }

  /** @internal — the wx image to draw on `node`, or null while it loads there. */
  _for(node: WxCanvasNode): WxImage | null {
    if (this._ready.has(node)) return this._perNode.get(node) ?? null;
    if (this._resolved && !this._perNode.has(node)) this._load(node, false);
    return null;
  }

  private _load(node: WxCanvasNode, settle: boolean): void {
    const image = node.createImage();
    this._perNode.set(node, image);
    const src = this._resolved;
    image.onload = () => {
      if (src !== this._resolved) return;
      this._ready.add(node);
      if (!settle) return;
      this.width = image.width;
      this.height = image.height;
      this.complete = true;
      this.onload?.();
    };
    image.onerror = (e) => {
      if (src !== this._resolved) return;
      this._perNode.delete(node);
      if (!settle) return;
      this.complete = true;
      const msg = (e as { errMsg?: string } | undefined)?.errMsg;
      this.onerror?.(msg ? `image load failed: ${src} (${msg})` : `image load failed: ${src}`);
    };
    image.src = src;
  }
}

export function loadCanvasImage(
  src: string,
  onload?: (image: WxCanvasImage) => void,
  onerror?: (message: string) => void,
): WxCanvasImage {
  const image = new WxCanvasImage();
  image.onload = () => onload?.(image);
  image.onerror = (message) => onerror?.(message);
  image.src = src;
  return image;
}

function addLiveNode(node: WxCanvasNode): void {
  liveNodes.add(node);
  if (!waitingImages.size) return;
  const waiting = [...waitingImages];
  waitingImages.clear();
  for (const image of waiting) image._loadOn(node);
}

// ---- context ----------------------------------------------------------------

/** drawImage / createPattern take the fjs handle; the node wants its own
 * image. */
function wrapContext(node: WxCanvasNode, raw: Ctx2D, api: unknown): Ctx2D {
  const drawImage = raw.drawImage as (...args: unknown[]) => void;
  const createPattern = raw.createPattern as ((...args: unknown[]) => unknown) | undefined;
  const unwrap = (image: unknown): unknown =>
    image instanceof WxCanvasImage ? image._for(node) : image;
  const patched: Record<string, unknown> = {
    drawImage(image: unknown, ...args: unknown[]) {
      const real = unwrap(image);
      // still decoding on this node: skip, as a browser skips an image that
      // is not complete yet
      if (real) drawImage.call(raw, real, ...args);
    },
    createPattern(image: unknown, repetition: unknown) {
      const real = unwrap(image);
      return real && createPattern ? createPattern.call(raw, real, repetition) : null;
    },
    canvas: api,
  };
  if (typeof raw.reset !== 'function') {
    // back to the logical-pixel transform the surface established
    patched.reset = () => {
      raw.setTransform(1, 0, 0, 1, 0, 0);
      (raw.clearRect as (...a: number[]) => void).call(raw, 0, 0, node.width, node.height);
      const dpr = (api as { devicePixelRatio: number }).devicePixelRatio;
      raw.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
  }
  return forwardContext(raw, patched);
}

/** A plain object standing in for the 2d context: every method forwards
 * with the real context as `this`, every other property is a get/set pair,
 * and all of it is configurable. Not a patch of the native object and not a
 * Proxy: on a real device the context's own `canvas` is non-configurable, so
 * both would make a library that overrides `ctx.canvas` (the F2 adapter
 * does) throw "Cannot redefine property". */
function forwardContext(raw: Ctx2D, patched: Record<string, unknown>): Ctx2D {
  const out: Record<string, unknown> = {};
  const seen = new Set<string>(['constructor']);
  for (let o: object | null = raw; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    for (const key of Object.getOwnPropertyNames(o)) {
      if (seen.has(key) || key in patched) continue;
      seen.add(key);
      let value: unknown;
      try {
        value = raw[key];
      } catch {
        continue;
      }
      if (typeof value === 'function') {
        const fn = value as (...args: unknown[]) => unknown;
        out[key] = (...args: unknown[]) => fn.apply(raw, args);
      } else {
        Object.defineProperty(out, key, {
          get: () => raw[key],
          set: (v: unknown) => {
            raw[key] = v;
          },
          enumerable: true,
          configurable: true,
        });
      }
    }
  }
  // a host object that hides its members from reflection: patch it instead
  if (typeof out.fillRect !== 'function') return patchContext(raw, patched);
  for (const [key, value] of Object.entries(patched)) {
    Object.defineProperty(out, key, { value, writable: true, enumerable: true, configurable: true });
  }
  return out as Ctx2D;
}

/** A WebGL context takes the fjs handle wherever an image source goes. */
function wrapWebgl(node: WxCanvasNode, raw: Record<string, unknown>): Record<string, unknown> {
  const unwrap = (image: unknown): unknown =>
    image instanceof WxCanvasImage ? image._for(node) : image;
  const patched: Record<string, unknown> = {};
  for (const name of ['texImage2D', 'texSubImage2D']) {
    const original = raw[name] as ((...args: unknown[]) => unknown) | undefined;
    if (typeof original !== 'function') continue;
    patched[name] = (...args: unknown[]) => {
      const last = args.length - 1;
      if (args[last] instanceof WxCanvasImage) {
        const real = unwrap(args[last]);
        if (!real) return undefined; // not decoded on this node yet
        args[last] = real;
      }
      return original.apply(raw, args);
    };
  }
  return patchContext(raw, patched);
}

/** Puts `patched` over the context: own properties on the instance (a plain
 * object in the base library), or a Proxy if the instance refuses them. */
function patchContext<T extends Record<string, unknown>>(raw: T, patched: Record<string, unknown>): T {
  const keys = Object.keys(patched);
  if (!keys.length) return raw;
  try {
    for (const k of keys) {
      Object.defineProperty(raw, k, { value: patched[k], configurable: true, writable: true });
    }
    if (raw[keys[0]] === patched[keys[0]]) return raw;
  } catch {
    // fall through to the proxy
  }
  const bound = new Map<PropertyKey, unknown>();
  return new Proxy(raw, {
    get(target, key) {
      if (typeof key === 'string' && key in patched) return patched[key];
      const value = Reflect.get(target, key);
      if (typeof value !== 'function') return value;
      let fn = bound.get(key);
      if (!fn) bound.set(key, (fn = (value as (...a: unknown[]) => unknown).bind(target)));
      return fn;
    },
    set(target, key, value) {
      return Reflect.set(target, key, value);
    },
  });
}

// ---- refs ---------------------------------------------------------------------

interface Surface {
  node: WxCanvasNode;
  api: Record<string, unknown>;
  measure(width: number, height: number): boolean;
}

function pixelRatio(): number {
  const info =
    typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
  return Number(info?.pixelRatio) || 1;
}

function makeSurface(node: WxCanvasNode): Surface {
  let width = 0;
  let height = 0;
  /** the ratio the backing store was last sized by — what devicePixelRatio
   * reports, so a library scaling by it matches the bitmap exactly */
  let ratio = pixelRatio();
  let ctx: Ctx2D | null = null;
  let rawCtx: Ctx2D | null = null;
  const gl = new Map<string, unknown>();
  const api: Record<string, unknown> = markRaw({
    getContext(type: string): unknown {
      if (type === 'webgl' || type === 'webgl2') {
        // the node's `type` attribute (compiler: pages importing
        // @ufjs/webgl) decides whether it has WebGL at all
        if (ctx) return null;
        if (gl.has(type)) return gl.get(type);
        let raw: Record<string, unknown> | null = null;
        try {
          raw = node.getContext(type) as Record<string, unknown> | null;
        } catch {
          raw = null;
        }
        // a base library without WebGL 2 may answer 'webgl2' with a 1.0
        // context; null lets the page's `?? getContext('webgl')` fall back
        if (raw && type === 'webgl2' && typeof raw.createVertexArray !== 'function') raw = null;
        if (!raw) return null;
        const wrapped = wrapWebgl(node, raw);
        gl.set(type, wrapped);
        return wrapped;
      }
      if (type !== '2d' || gl.size) return null;
      if (!ctx) {
        let raw: Ctx2D | null = null;
        try {
          raw = node.getContext('2d') as Ctx2D | null;
        } catch {
          raw = null;
        }
        if (!raw) return null;
        rawCtx = raw;
        rawCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx = wrapContext(node, rawCtx, api);
      }
      return ctx;
    },
    toDataURL(type?: string, quality?: number): Promise<string> {
      try {
        return Promise.resolve(node.toDataURL ? node.toDataURL(type, quality) : '');
      } catch (err) {
        return Promise.reject(err);
      }
    },
    get width(): number {
      return width;
    },
    get height(): number {
      return height;
    },
    // the backing store is already scaled; exposed for libraries that reset
    // the transform, as on web
    get devicePixelRatio(): number {
      return ratio;
    },
    /** the wx canvas node, for code that needs the platform object */
    get node(): WxCanvasNode {
      return node;
    },
  });
  return {
    node,
    api,
    measure(w: number, h: number): boolean {
      const nw = Math.max(0, Math.round(w));
      const nh = Math.max(0, Math.round(h));
      if (nw === width && nh === height) return false;
      width = nw;
      height = nh;
      ratio = pixelRatio();
      // resizing the backing store clears it and resets the transform
      node.width = Math.round(nw * ratio);
      node.height = Math.round(nh * ratio);
      rawCtx?.setTransform(ratio, 0, 0, ratio, 0, 0);
      return true;
    },
  };
}

interface CanvasBinding {
  surfaces: Map<string, Surface>;
}

const bindings = new Map<Host, CanvasBinding>();
let windowHooked = false;

type Fns = Record<string, (...args: unknown[]) => unknown>;

/** Looks up this instance's canvas refs after its first render and hands
 * each page ref its FjsCanvasApi; re-measures on window resize. */
export function attachCanvases(
  host: Host,
  refs: WxCanvasRef[] | undefined,
  returned: Record<string, unknown>,
  fns: Fns,
): void {
  if (!refs?.length || bindings.has(host)) return;
  const binding: CanvasBinding = { surfaces: new Map() };
  bindings.set(host, binding);
  hookWindowResize();
  query(host, binding, refs, returned, fns);
}

export function detachCanvases(host: Host): void {
  const binding = bindings.get(host);
  if (!binding) return;
  bindings.delete(host);
  for (const surface of binding.surfaces.values()) liveNodes.delete(surface.node);
}

const hostState = new WeakMap<Host, { refs: WxCanvasRef[]; returned: Record<string, unknown>; fns: Fns }>();

function hookWindowResize(): void {
  if (windowHooked || typeof wx.onWindowResize !== 'function') return;
  windowHooked = true;
  wx.onWindowResize(() => {
    for (const [host, binding] of bindings) {
      const s = hostState.get(host);
      if (s) query(host, binding, s.refs, s.returned, s.fns);
    }
  });
}

function query(
  host: Host,
  binding: CanvasBinding,
  refs: WxCanvasRef[],
  returned: Record<string, unknown>,
  fns: Fns,
): void {
  hostState.set(host, { refs, returned, fns });
  const q = host.createSelectorQuery();
  for (const r of refs) {
    q.select(`#fjs-cv-${r.ref}`).fields({ node: true, size: true, dataset: true });
  }
  q.exec((results) => {
    if (!bindings.has(host)) return; // unmounted while the query ran
    refs.forEach((r, i) => {
      const res = results?.[i] as
        | { node?: WxCanvasNode; width?: number; height?: number; dataset?: Record<string, unknown> }
        | null
        | undefined;
      if (!res?.node) {
        console.warn(`[fjs/wx] canvas ref "${r.ref}" not found (inside v-if / v-for?)`);
        return;
      }
      let surface = binding.surfaces.get(r.ref);
      if (!surface || surface.node !== res.node) {
        if (surface) liveNodes.delete(surface.node);
        surface = makeSurface(res.node);
        binding.surfaces.set(r.ref, surface);
        addLiveNode(res.node);
        const target = returned[r.ref];
        if (isRef(target)) (target as Ref<unknown>).value = surface.api;
      }
      const changed = surface.measure(res.width ?? 0, res.height ?? 0);
      if (changed && r.resize) {
        emitResize(fns, res.dataset, surface.api.width as number, surface.api.height as number);
      }
    });
  });
}

function emitResize(
  fns: Fns,
  dataset: Record<string, unknown> | undefined,
  width: number,
  height: number,
): void {
  const fn = fns[String(dataset?.fn ?? '')];
  if (!fn) return;
  const payload = `{"width":${width},"height":${height}}`;
  const args = Array.isArray(dataset?.args) ? (dataset!.args as unknown[]) : [];
  try {
    if ((fn as { __fjsByType?: boolean }).__fjsByType) fn('resize', payload, ...args);
    else fn(payload, ...args);
  } catch (err) {
    console.error('[fjs/wx] canvas resize handler failed:', err);
  }
}
