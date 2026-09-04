// Which src values are loadable, and what an asset:// becomes on each of the
// three targets. flutter/lib/fjs_webview.dart mirrors the two app rows.
import { describe, expect, it } from 'vitest';
import {
  APP_ASSET_BASE,
  assetPath,
  classifySrc,
  localPath,
  resolveSrc,
  unsupportedSrcMessage,
  WEB_ASSET_BASE,
} from '../index';

describe('classifySrc', () => {
  it('takes http(s), the module\'s own asset scheme, and the app\'s own pages', () => {
    expect(classifySrc('https://example.com')).toBe('http');
    expect(classifySrc('http://example.com')).toBe('http');
    expect(classifySrc('asset://demo.html')).toBe('asset');
    // a root path is the app's own file, from the project's html/
    expect(classifySrc('/html/guide.html')).toBe('local');
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
      suffix: '',
    });
  });

  it('separates the release asset key from its document suffix', () => {
    // loadFlutterAsset looks the string up in the bundle manifest, so the
    // query cannot be part of the key. The suffix is kept for the document
    // URL so the page still sees its parameters.
    expect(
      resolveSrc('asset://demo.html?q=hello#top', { target: 'app-release' }),
    ).toEqual({
      kind: 'flutter-asset',
      asset: 'assets/fjs/modules/webview/demo.html',
      suffix: '?q=hello#top',
    });
    expect(
      resolveSrc('asset://demo.html?q=hello#top', {
        target: 'app-dev',
        devHost: 'http://127.0.0.1:38900',
      }),
    ).toEqual({
      kind: 'url',
      url: 'http://127.0.0.1:38900/modules/webview/demo.html?q=hello#top',
    });
  });

  it('resolves nothing for empty and unsupported', () => {
    expect(resolveSrc('', { target: 'web' })).toEqual({ kind: 'none' });
    expect(resolveSrc('file:///x', { target: 'web' })).toEqual({ kind: 'none' });
    expect(resolveSrc('asset://../x', { target: 'web' })).toEqual({ kind: 'none' });
  });
});

describe('localPath', () => {
  it('strips leading slashes and refuses to escape', () => {
    expect(localPath('/html/guide.html')).toBe('html/guide.html');
    expect(localPath('///html/guide.html')).toBe('html/guide.html');
    expect(localPath('/../secret')).toBeNull();
    expect(localPath('/a/../../b')).toBeNull();
    expect(localPath('/')).toBeNull();
  });
});

describe('resolveSrc for the app\'s own pages', () => {
  const src = '/html/guide.html';

  it('is a plain root URL on the web', () => {
    expect(resolveSrc(src, { target: 'web' })).toEqual({
      kind: 'url',
      url: '/html/guide.html',
    });
  });

  it('comes off the dev server while one is connected', () => {
    expect(resolveSrc(src, { target: 'app-dev', devHost: 'http://127.0.0.1:38900' })).toEqual({
      kind: 'url',
      url: 'http://127.0.0.1:38900/html/guide.html',
    });
    // a trailing slash on the host must not double up
    expect(resolveSrc(src, { target: 'app-dev', devHost: 'http://h:1/' })).toEqual({
      kind: 'url',
      url: 'http://h:1/html/guide.html',
    });
  });

  it('is a Flutter asset key in a release build', () => {
    expect(resolveSrc(src, { target: 'app-release' })).toEqual({
      kind: 'flutter-asset',
      asset: `${APP_ASSET_BASE}/html/guide.html`,
      suffix: '',
    });
  });

  it('splits query and hash off the asset key, same as asset://', () => {
    // loadFlutterAsset looks the string up in the bundle manifest, so
    // "guide.html?q=1" is simply not a file
    expect(resolveSrc('/html/guide.html?q=1#top', { target: 'app-release' })).toEqual({
      kind: 'flutter-asset',
      asset: `${APP_ASSET_BASE}/html/guide.html`,
      suffix: '?q=1#top',
    });
  });

  it('resolves to nothing when the path escapes', () => {
    expect(resolveSrc('/../secret.html', { target: 'web' })).toEqual({ kind: 'none' });
  });
});
