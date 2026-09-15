// wx canvas bridge (src/wx/canvas.ts): ref binding, resize, and the 2d
// context stand-in pages and libraries draw through.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachCanvases, detachCanvases, loadCanvasImage } from '../src/wx/canvas';

/** A context shaped like the real device's: methods on the prototype, and
 * an own `canvas` that cannot be redefined. */
class DeviceCtx {
  fillStyle = '#000';
  calls: unknown[][] = [];
  constructor(node: unknown) {
    Object.defineProperty(this, 'canvas', { value: node, enumerable: true });
  }
  fillRect(...args: unknown[]) {
    this.calls.push(['fillRect', this, ...args]);
  }
  drawImage(...args: unknown[]) {
    this.calls.push(['drawImage', ...args]);
  }
  setTransform(...args: unknown[]) {
    this.calls.push(['setTransform', ...args]);
  }
}

function fakeNode() {
  const images: Array<{ src: string; width: number; height: number; onload: (() => void) | null; onerror: unknown }> = [];
  const node = {
    width: 0,
    height: 0,
    ctx: null as DeviceCtx | null,
    images,
    getContext(type: string) {
      if (type !== '2d') return null;
      return (node.ctx ??= new DeviceCtx(node));
    },
    createImage() {
      const image = { src: '', width: 0, height: 0, onload: null as (() => void) | null, onerror: null };
      images.push(image);
      return image;
    },
  };
  return node;
}

function fakeHost(node: ReturnType<typeof fakeNode>, size = { width: 100, height: 50 }) {
  return {
    createSelectorQuery() {
      return {
        select() {
          return {
            fields() {
              return this;
            },
            exec() {},
          };
        },
        exec(cb: (res: unknown[]) => void) {
          cb([{ node, ...size, dataset: { fn: 'onResize' } }]);
        },
      };
    },
  };
}

describe('wx canvas', () => {
  beforeEach(() => {
    vi.stubGlobal('wx', { getWindowInfo: () => ({ pixelRatio: 2, windowWidth: 375, windowHeight: 667 }) });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('binds the ref, sizes the backing store and emits resize', () => {
    const node = fakeNode();
    const host = fakeHost(node);
    const cv = { __v_isRef: true, value: undefined as unknown };
    const onResize = vi.fn();
    attachCanvases(host as never, [{ ref: 'cv', resize: true }], { cv }, { onResize });
    const api = cv.value as { width: number; height: number };
    expect(api.width).toBe(100);
    expect(api.height).toBe(50);
    expect(node.width).toBe(200);
    expect(onResize).toHaveBeenCalledWith('{"width":100,"height":50}');
    detachCanvases(host as never);
  });

  it('lets a library redefine ctx.canvas on a device context', () => {
    const node = fakeNode();
    const host = fakeHost(node);
    const cv = { __v_isRef: true, value: undefined as unknown };
    attachCanvases(host as never, [{ ref: 'cv' }], { cv }, {});
    const ctx = (cv.value as { getContext(t: string): Record<string, unknown> }).getContext('2d');
    const fake = { width: 1, height: 1 };
    // what the F2 adapter does
    Object.defineProperty(ctx, 'canvas', { get: () => fake, configurable: true });
    expect(ctx.canvas).toBe(fake);
    // methods still run against the real context
    (ctx.fillRect as (...a: number[]) => void)(1, 2, 3, 4);
    expect(node.ctx!.calls.at(-1)).toEqual(['fillRect', node.ctx, 1, 2, 3, 4]);
    ctx.fillStyle = '#fff';
    expect(node.ctx!.fillStyle).toBe('#fff');
    detachCanvases(host as never);
  });

  it('draws a loadCanvasImage handle once it decoded on the node', () => {
    const node = fakeNode();
    const onload = vi.fn();
    const image = loadCanvasImage('/a.png', onload);
    const host = fakeHost(node);
    const cv = { __v_isRef: true, value: undefined as unknown };
    attachCanvases(host as never, [{ ref: 'cv' }], { cv }, {});
    const wxImage = node.images[0];
    expect(wxImage.src).toBe('/a.png');
    wxImage.width = 8;
    wxImage.height = 4;
    wxImage.onload!();
    expect(onload).toHaveBeenCalled();
    expect(image.width).toBe(8);
    const ctx = (cv.value as { getContext(t: string): Record<string, unknown> }).getContext('2d');
    (ctx.drawImage as (...a: unknown[]) => void)(image, 0, 0);
    expect(node.ctx!.calls.at(-1)).toEqual(['drawImage', wxImage, 0, 0]);
    detachCanvases(host as never);
  });
});
