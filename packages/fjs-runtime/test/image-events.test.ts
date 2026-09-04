import { describe, expect, it } from 'vitest';
import {
  encodeImageError,
  encodeImageLoad,
  IMAGE_ERROR_MESSAGE,
  ImageLoadCycle,
} from '../src/image/events';

describe('image event payloads', () => {
  it('keeps load keys and order stable', () => {
    expect(encodeImageLoad(600, 400)).toBe('{"width":600,"height":400}');
    expect(encodeImageLoad(-1.2, 3.7)).toBe('{"width":0,"height":4}');
  });

  it('uses one stable error message', () => {
    expect(encodeImageError()).toBe(
      `{"errMsg":"${IMAGE_ERROR_MESSAGE}"}`,
    );
    expect(encodeImageError('')).toBe(
      `{"errMsg":"${IMAGE_ERROR_MESSAGE}"}`,
    );
  });

  it('allows only one terminal event per source generation', () => {
    const cycle = new ImageLoadCycle();
    const first = cycle.begin();
    expect(cycle.finish(first, 'load')).toBe(true);
    expect(cycle.finish(first, 'error')).toBe(false);
    expect(cycle.finish(first, 'load')).toBe(false);

    const second = cycle.begin();
    expect(cycle.finish(first, 'error')).toBe(false);
    expect(cycle.finish(second, 'error')).toBe(true);
  });
});
