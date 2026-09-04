// Which tags the SFC compiler is told are elements.
//
// This is worth a test of its own because the failure mode is silent: a
// component compiled as an element renders nothing, raises nothing, and
// looks like a styling problem. `form` and `textarea` are the two tags fjs
// implements as components whose names are also real HTML tags, so they are
// exactly the ones an ordering mistake would break.
import { describe, expect, it } from 'vitest';
import { isNativeTagFor, webIsNativeTag } from '../src/bundler/vue-plugin';

describe('isNativeTagFor', () => {
  for (const web of [false, true]) {
    const where = web ? 'web' : 'flutter';

    it(`keeps the component tags non-native on ${where}`, () => {
      for (const tag of ['form', 'textarea', 'picker', 'list-view']) {
        expect(isNativeTagFor(tag, { web })).toBe(false);
      }
    });
  }

  it('flutter: fjs tags and plain HTML are elements', () => {
    expect(isNativeTagFor('view')).toBe(true);
    expect(isNativeTagFor('input')).toBe(true);
    expect(isNativeTagFor('div')).toBe(true);
  });

  it('web: fjs tags go through resolveComponent, HTML does not', () => {
    expect(isNativeTagFor('view', { web: true })).toBe(false);
    expect(isNativeTagFor('input', { web: true })).toBe(false);
    expect(isNativeTagFor('div', { web: true })).toBe(true);
  });

  it('webIsNativeTag carries the guard itself', () => {
    // vite.ts and the SFC plugin both reach the web decision through this
    // function; a guard that only lived in the callers let `dev:web` render
    // a DOM <textarea>.
    expect(webIsNativeTag('textarea')).toBe(false);
    expect(webIsNativeTag('form')).toBe(false);
    expect(webIsNativeTag('div')).toBe(true);
  });

  it('a module tag is an element, but a component tag still wins', () => {
    const moduleTags = new Set(['map-view', 'textarea']);
    expect(isNativeTagFor('map-view', { moduleTags })).toBe(true);
    expect(isNativeTagFor('textarea', { moduleTags })).toBe(false);
  });
});
