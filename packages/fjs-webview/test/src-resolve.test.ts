// Which src values are loadable, and what an asset:// becomes on each of the
// three targets. flutter/lib/fjs_webview.dart mirrors the two app rows.
import { describe, expect, it } from 'vitest';
import {
  assetPath,
  classifySrc,
  resolveSrc,
  unsupportedSrcMessage,
  WEB_ASSET_BASE,
} from '../index';

describe('classifySrc', () => {
  it('takes http(s) and the module\'s own asset scheme', () => {
    expect(classifySrc('https://example.com')).toBe('http');
    expect(classifySrc('http://example.com')).toBe('http');
    expect(classifySrc('asset://demo.html')).toBe('asset');
  });

  it('treats an empty or missing src as nothing to load', () => {
    expect(classifySrc('')).toBe('empty');
    expect(classifySrc('   ')).toBe('empty');
    expect(classifySrc(undefined)).toBe('empty');
    expect(classifySrc(null)).toBe('empty');
  });

  it('refuses the schemes that differ too much between the two ends', () => {
    for (const src of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:text/html,<b>x</b>',
      'about:blank',
      'example.com',
    ]) {
      expect(classifySrc(src)).toBe('unsupported');
    }
    expect(unsupportedSrcMessage('file:///x')).toContain('file:///x');
  });
});

describe('assetPath', () => {
  it('strips the scheme and leading slashes', () => {
    expect(assetPath('asset://demo.html')).toBe('demo.html');
    expect(assetPath('asset:///demo.html')).toBe('demo.html');
    expect(assetPath('asset://pages/a.html')).toBe('pages/a.html');
  });

  it('refuses to escape the module directory', () => {
    expect(assetPath('asset://../secret')).toBeNull();
    expect(assetPath('asset://a/../../b')).toBeNull();
    expect(assetPath('asset://')).toBeNull();
  });
});

describe('resolveSrc', () => {
  it('leaves an http src alone on every target', () => {
    for (const where of [
      { target: 'web' } as const,
      { target: 'app-dev', devHost: 'http://127.0.0.1:38900' } as const,
      { target: 'app-release' } as const,
    ]) {
      expect(resolveSrc('https://example.com/a', where)).toEqual({
        kind: 'url',
        url: 'https://example.com/a',
      });
    }
  });

  it('serves an asset from the app static root on the web', () => {
    expect(resolveSrc('asset://demo.html', { target: 'web' })).toEqual({
      kind: 'url',
      url: `${WEB_ASSET_BASE}/demo.html`,
    });
  });

  it('serves an asset from the dev server while fjs dev is connected', () => {
    expect(
      resolveSrc('asset://demo.html', {
        target: 'app-dev',
        devHost: 'http://127.0.0.1:38900/',
      }),
    ).toEqual({
      kind: 'url',
      url: 'http://127.0.0.1:38900/modules/webview/demo.html',
    });
  });

  it('is a Flutter asset in a release build, not a URL', () => {
    // a distinct shape on purpose: the Dart side loads it with
    // loadFlutterAsset, which does not take a URL
    expect(resolveSrc('asset://demo.html', { target: 'app-release' })).toEqual({
      kind: 'flutter-asset',
      asset: 'assets/fjs/modules/webview/demo.html',
      droppedQuery: false,
    });
  });

  it('drops a query from the asset key, and says it did', () => {
    // Found in a release build: loadFlutterAsset looks the string up in the
    // bundle manifest, so `demo.html?q=hello` is not a file and the platform
    // throws FWFURLParsingError. Dev keeps the query (it is an HTTP URL
    // there), so this difference has to be reported.
    expect(
      resolveSrc('asset://demo.html?q=hello', { target: 'app-release' }),
    ).toEqual({
      kind: 'flutter-asset',
      asset: 'assets/fjs/modules/webview/demo.html',
      droppedQuery: true,
    });
    expect(
      resolveSrc('asset://demo.html?q=hello', {
        target: 'app-dev',
        devHost: 'http://127.0.0.1:38900',
      }),
    ).toEqual({
      kind: 'url',
      url: 'http://127.0.0.1:38900/modules/webview/demo.html?q=hello',
    });
  });

  it('resolves nothing for empty and unsupported', () => {
    expect(resolveSrc('', { target: 'web' })).toEqual({ kind: 'none' });
    expect(resolveSrc('file:///x', { target: 'web' })).toEqual({ kind: 'none' });
    expect(resolveSrc('asset://../x', { target: 'web' })).toEqual({ kind: 'none' });
  });
});
