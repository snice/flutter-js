// @vitest-environment happy-dom
//
// The `canvas` COMPONENT: the box around the drawing surface. One component
// serves both platforms (it is pointed at the `inner-canvas` element on
// Flutter and at the web adapter's surface here), so what this pins — the
// structure, the forwarded event, the exposed API — is the contract a page
// sees on either.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref, type Component } from 'vue';

import { createFjsCanvas } from '../src/components/canvas';
import { FjsCanvasSurface } from '../src/web/components/canvas';

const FjsCanvas = createFjsCanvas(FjsCanvasSurface);

interface CanvasApi {
  getContext(type: string): unknown;
  toDataURL(type?: string, quality?: number): Promise<string>;
  readonly width: number;
  readonly height: number;
}

function mount(props: Record<string, unknown> = {}, slot?: () => unknown) {
  const api = ref<CanvasApi | null>(null);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const context = { setTransform: () => {} };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    ((type: string) => (type === '2d' ? context : null)) as never,
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, width: 300, height: 150, top: 0, left: 0, right: 300, bottom: 150,
    toJSON: () => ({}),
  } as DOMRect);
  createApp({
    render: () => h(FjsCanvas, { ref: api as never, ...props }, slot ? { default: slot } : undefined),
  } as Component).mount(host);
  return { host, api };
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('canvas component', () => {
  it('renders a box with the surface inside it', async () => {
    const { host } = mount();
    await nextTick();
    const box = host.querySelector('view');
    expect(box).not.toBeNull();
    expect(box!.querySelector('canvas')).not.toBeNull();
  });

  it('puts slot content in the box, after the surface', async () => {
    // this is what the box is FOR: a tooltip or legend that lives on the
    // canvas without being drawn into the bitmap
    const { host } = mount({}, () => [h('view', { class: 'tip' }, 'hello')]);
    await nextTick();
    const children = [...(host.querySelector('view')?.children ?? [])];
    expect(children.map((c) => c.tagName.toLowerCase())).toEqual(['canvas', 'view']);
    expect(host.querySelector('.tip')?.textContent).toBe('hello');
  });

  it('forwards the surface API to the page', async () => {
    const { api } = mount();
    await nextTick();
    expect(api.value!.getContext('2d')).not.toBeNull();
    expect(api.value!.width).toBe(300);
    expect(api.value!.height).toBe(150);
  });

  it('forwards @resize from the surface', async () => {
    const seen: string[] = [];
    mount({ onResize: (payload: string) => seen.push(payload) });
    await nextTick();
    expect(seen).toEqual(['{"width":300,"height":150}']);
  });

  it('keeps the page style, and stays the positioning context', async () => {
    const { host } = mount({ style: { height: '200px' } });
    await nextTick();
    const box = host.querySelector('view') as HTMLElement;
    // the page's own style survives; `position: relative` rides underneath
    // it so an absolutely positioned overlay resolves against this box
    expect(box.style.height).toBe('200px');
    expect(box.style.position).toBe('relative');
  });
});
