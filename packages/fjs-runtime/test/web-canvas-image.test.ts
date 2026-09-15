// @vitest-environment happy-dom
//
// loadCanvasImage on web: no host to decode, so it has to hand back something
// the browser's own drawImage accepts — a real image element — while keeping
// the callback shape a page wrote against the app side.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadCanvasImage } from '../src/canvas/image';

/** happy-dom does not fetch images, so the element is stubbed and the test
 * fires load / error itself. */
class FakeImage {
  static last: FakeImage | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = '';
  width = 0;
  height = 0;
  constructor() {
    FakeImage.last = this;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeImage.last = null;
});

describe('web loadCanvasImage', () => {
  it('returns the browser image and calls onload with it', () => {
    vi.stubGlobal('Image', FakeImage);
    const loaded: unknown[] = [];
    const image = loadCanvasImage('/fb/bird1.png', (img) => loaded.push(img));
    const element = FakeImage.last!;
    expect(image).toBe(element);
    expect(element.src).toBe('/fb/bird1.png');

    element.width = 92;
    element.height = 64;
    element.onload!();
    expect(loaded).toEqual([image]);
    expect(image.width).toBe(92);
  });

  it('resolves asset:// the same way <image> does', () => {
    vi.stubGlobal('Image', FakeImage);
    loadCanvasImage('asset://images/x.png');
    expect(FakeImage.last!.src).toBe('/images/x.png');
  });

  it('reports a failed load as a message', () => {
    vi.stubGlobal('Image', FakeImage);
    const errors: string[] = [];
    loadCanvasImage('/missing.png', undefined, (message) => errors.push(message));
    FakeImage.last!.onerror!();
    expect(errors).toEqual(['image load failed: /missing.png']);
  });
});
