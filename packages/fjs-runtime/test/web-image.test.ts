// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref, type Component } from 'vue';
import { FjsImage, resolveImageSrc } from '../src/web/components/basic';
import { IMAGE_LAZY_PRELOAD_PX } from '../src/image/lazy';

function mount(props: Record<string, unknown>) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  createApp({
    render: () => h(FjsImage, props),
  } as Component).mount(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('web image', () => {
  it('loads asset sources and emits the intrinsic size payload', async () => {
    const loaded: string[] = [];
    const host = mount({
      src: 'asset://images/photo.png',
      onLoad: (payload: string) => loaded.push(payload),
    });
    await nextTick();
    const image = host.querySelector('img') as HTMLImageElement;
    expect(image.getAttribute('src')).toBe('/images/photo.png');
    Object.defineProperty(image, 'naturalWidth', { value: 600 });
    Object.defineProperty(image, 'naturalHeight', { value: 400 });
    image.dispatchEvent(new Event('load'));
    image.dispatchEvent(new Event('load'));
    expect(loaded).toEqual(['{"width":600,"height":400}']);
  });

  it('keeps a local src root-absolute so a nested route cannot rebase it', () => {
    // The bug this replaced: `asset://images/x.png` became the relative
    // `images/x.png`, which on a page at /comp/image asks for
    // /comp/images/x.png and gets the SPA fallback's HTML with a 200 —
    // a broken image and nothing in the log (specs/017-local-image-assets).
    expect(resolveImageSrc('asset://images/photo.png')).toBe('/images/photo.png');
    expect(resolveImageSrc('asset:///images/photo.png')).toBe('/images/photo.png');
    expect(resolveImageSrc('/assets/photo-ABC123.png')).toBe('/assets/photo-ABC123.png');
    expect(resolveImageSrc('https://example.com/photo.png')).toBe(
      'https://example.com/photo.png',
    );
    // an author-written relative src keeps browser semantics
    expect(resolveImageSrc('./photo.png')).toBe('./photo.png');
  });

  it('emits one stable error payload', async () => {
    const errors: string[] = [];
    const host = mount({
      src: 'https://invalid.example/photo.png',
      onError: (payload: string) => errors.push(payload),
    });
    await nextTick();
    const image = host.querySelector('img') as HTMLImageElement;
    image.dispatchEvent(new Event('error'));
    image.dispatchEvent(new Event('error'));
    expect(errors).toEqual(['{"errMsg":"image load failed"}']);
  });

  it('applies mode before legacy fit', async () => {
    const host = mount({
      src: 'asset://photo.png',
      mode: 'top left',
      fit: 'contain',
    });
    await nextTick();
    const image = host.querySelector('img') as HTMLImageElement;
    expect(image.style.objectFit).toBe('cover');
    expect(image.style.objectPosition).toBe('left top');
  });

  it('lets a heightFix image size itself instead of stretching', async () => {
    // Caught in the browser: `width: auto` inside a column flex still
    // stretches to the parent, so a heightFix image was as wide as its
    // container while Flutter used height * ratio.
    const host = mount({ src: 'asset://photo.png', mode: 'heightFix' });
    await nextTick();
    const image = host.querySelector('img') as HTMLImageElement;
    expect(image.style.width).toBe('auto');
    expect(image.style.alignSelf).toBe('flex-start');

    const fixWidth = mount({ src: 'asset://photo.png', mode: 'widthFix' });
    await nextTick();
    const other = fixWidth.querySelector('img') as HTMLImageElement;
    expect(other.style.height).toBe('auto');
    expect(other.style.alignSelf).toBe('');
  });

  it('waits for intersection when lazy-load is set', async () => {
    const starts: Element[] = [];
    let intersect: IntersectionObserverCallback | null = null;
    let options: IntersectionObserverInit | undefined;
    class FakeObserver {
      callback: IntersectionObserverCallback;
      constructor(
        callback: IntersectionObserverCallback,
        init?: IntersectionObserverInit,
      ) {
        this.callback = callback;
        intersect = callback;
        options = init;
      }
      observe(target: Element) {
        starts.push(target);
      }
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver);

    const host = mount({
      src: 'https://example.com/lazy.png',
      lazyLoad: true,
    });
    await nextTick();
    const image = host.querySelector('img') as HTMLImageElement;
    expect(image.getAttribute('src')).toBeNull();
    expect(starts).toEqual([image]);
    // the same margin Flutter preloads by (image/lazy.ts)
    expect(options?.rootMargin).toBe(`${IMAGE_LAZY_PRELOAD_PX}px`);
    intersect?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    await nextTick();
    expect((host.querySelector('img') as HTMLImageElement).getAttribute('src'))
      .toBe('https://example.com/lazy.png');
  });

  it('ignores a load from the old source after the source changes', async () => {
    const source = ref('asset://first.png');
    const loaded: string[] = [];
    const host = document.createElement('div');
    document.body.appendChild(host);
    createApp({
      render: () =>
        h(FjsImage, {
          src: source.value,
          onLoad: (payload: string) => loaded.push(payload),
        }),
    } as Component).mount(host);
    await nextTick();
    const oldImage = host.querySelector('img') as HTMLImageElement;
    source.value = 'asset://second.png';
    await nextTick();
    await nextTick();
    Object.defineProperty(oldImage, 'naturalWidth', { value: 1 });
    Object.defineProperty(oldImage, 'naturalHeight', { value: 1 });
    oldImage.dispatchEvent(new Event('load'));
    const current = host.querySelector('img') as HTMLImageElement;
    Object.defineProperty(current, 'naturalWidth', { value: 2 });
    Object.defineProperty(current, 'naturalHeight', { value: 3 });
    current.dispatchEvent(new Event('load'));
    expect(loaded).toEqual(['{"width":2,"height":3}']);
  });

  it('falls back to immediate loading when IntersectionObserver is absent', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('IntersectionObserver', undefined);
    const host = mount({
      src: 'https://example.com/lazy.png',
      lazyLoad: true,
    });
    await nextTick();
    await nextTick();
    expect((host.querySelector('img') as HTMLImageElement).getAttribute('src'))
      .toBe('https://example.com/lazy.png');
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
