// The dev server's /modules/<name>/<file> route.
//
// It served `application/json` for everything while the only consumer was
// iconmind's icons.json. A module that ships a PAGE broke on that in a way
// nothing reported: the WebView loaded it, fired its load event, and
// rendered the HTML source as text (specs/013-web-view).
import { describe, expect, it } from 'vitest';
import { moduleContentType } from '../src/dev/server';

describe('moduleContentType', () => {
  it('serves a page as a page', () => {
    expect(moduleContentType('/x/demo.html')).toBe('text/html; charset=utf-8');
    expect(moduleContentType('/x/demo.HTM')).toBe('text/html; charset=utf-8');
  });

  it('still serves generated data as json', () => {
    expect(moduleContentType('/x/icons.json')).toBe(
      'application/json; charset=utf-8',
    );
  });

  it('covers what a page pulls in', () => {
    expect(moduleContentType('a.js')).toBe('application/javascript; charset=utf-8');
    expect(moduleContentType('a.css')).toBe('text/css; charset=utf-8');
    expect(moduleContentType('a.svg')).toBe('image/svg+xml');
    expect(moduleContentType('a.png')).toBe('image/png');
    expect(moduleContentType('a.woff2')).toBe('font/woff2');
  });

  it('does not guess at anything else', () => {
    expect(moduleContentType('a.bin')).toBe('application/octet-stream');
    expect(moduleContentType('noextension')).toBe('application/octet-stream');
  });
});
