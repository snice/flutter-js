// @vitest-environment happy-dom
//
// The web canvas has to agree with the Flutter one on three things a page
// can observe: the coordinate system is logical pixels whatever the device
// ratio is, getContext caches, and an unimplemented context type is null on
// BOTH platforms (constitution I — a page that works in the browser and
// paints nothing in the app is the failure this prevents).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref, type Component } from 'vue';

import { FjsCanvasSurface } from '../src/web/components/canvas';
import { resetCanvasWarnings } from '../src/canvas/warn';

interface CanvasApi {
  getContext(type: string): unknown;
  toDataURL(type?: string, quality?: number): Promise<string>;
  readonly width: number;
  readonly height: number;
  readonly element: HTMLCanvasElement | null;
}

/** happy-dom has no layout and no 2d context, so both are stubbed: the
 * component's job here is the arithmetic and the routing, not painting. */
function mount(size: { width: number; height: number }) {
  const api = ref<CanvasApi | null>(null);
  const el = document.createElement('div');
  document.body.appendChild(el);
  const calls: Array<[string, number[]]> = [];
  const context = {
    setTransform: (...args: number[]) => calls.push(['setTransform', args]),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    ((type: string) => (type === '2d' ? context : null)) as never,
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    width: size.width,
    height: size.height,
    top: 0,
    left: 0,
    right: size.width,
    bottom: size.height,
    toJSON: () => ({}),
  } as DOMRect);
  createApp({
    render: () => h(FjsCanvasSurface, { ref: api as never }),
  } as Component).mount(el);
  return { host: el, api, calls, context };
}

beforeEach(() => {
  resetCanvasWarnings();
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('web canvas', () => {
  it('sizes the bitmap by the device ratio and keeps logical coordinates', async () => {
    (globalThis as { devicePixelRatio?: number }).devicePixelRatio = 2;
    const { host, api, calls } = mount({ width: 300, height: 200 });
    await nextTick();
    const canvas = host.querySelector('canvas') as HTMLCanvasElement;
    // the backing store is device pixels...
    expect([canvas.width, canvas.height]).toEqual([600, 400]);
    // ...while the page sees logical ones, because the context is pre-scaled
    expect(api.value!.width).toBe(300);
    expect(api.value!.height).toBe(200);
    expect(calls).toContainEqual(['setTransform', [2, 0, 0, 2, 0, 0]]);
  });

  it('emits @resize with the same payload the Flutter side sends', async () => {
    (globalThis as { devicePixelRatio?: number }).devicePixelRatio = 2;
    const seen: string[] = [];
    const el = document.createElement('div');
    document.body.appendChild(el);
    const context = { setTransform: () => {} };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      ((type: string) => (type === '2d' ? context : null)) as never,
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, width: 320, height: 180, top: 0, left: 0, right: 320, bottom: 180,
      toJSON: () => ({}),
    } as DOMRect);
    createApp({
      render: () => h(FjsCanvasSurface, { onResize: (payload: string) => seen.push(payload) }),
    } as Component).mount(el);
    await nextTick();
    // logical pixels, not the dpr-scaled backing store — byte for byte the
    // string canvas/surface.ts sends on Flutter
    expect(seen).toEqual(['{"width":320,"height":180}']);
  });

  it('returns the same 2d context on every call', async () => {
    (globalThis as { devicePixelRatio?: number }).devicePixelRatio = 1;
    const { api } = mount({ width: 100, height: 100 });
    await nextTick();
    const first = api.value!.getContext('2d');
    expect(first).not.toBeNull();
    expect(api.value!.getContext('2d')).toBe(first);
  });

  it('returns null for webgl and warns once, as Flutter does', async () => {
    (globalThis as { devicePixelRatio?: number }).devicePixelRatio = 1;
    const warnings: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    });
    const { api } = mount({ width: 100, height: 100 });
    await nextTick();
    expect(api.value!.getContext('webgl')).toBeNull();
    expect(api.value!.getContext('webgl')).toBeNull();
    expect(warnings.filter((w) => w.includes('webgl'))).toHaveLength(1);
  });
});
