// The three event payloads and the one-terminal-event-per-load gate. The
// Dart half writes the same strings (flutter/lib/fjs_webview.dart), which is
// what makes "two ends, one contract" checkable rather than aspirational.
import { describe, expect, it } from 'vitest';
import {
  errorPayload,
  LoadCycle,
  loadPayload,
  messagePayload,
  WEB_VIEW_ERROR,
} from '../index';

describe('payloads', () => {
  it('writes @load as one field', () => {
    expect(loadPayload('https://example.com/a')).toBe(
      '{"src":"https://example.com/a"}',
    );
  });

  it('writes @error with the src first and a stable message', () => {
    expect(errorPayload('https://example.com/a')).toBe(
      '{"src":"https://example.com/a","errMsg":"web-view load failed"}',
    );
    expect(WEB_VIEW_ERROR).toBe('web-view load failed');
  });

  it('passes the page string through verbatim', () => {
    expect(messagePayload('hello #1')).toBe('{"data":"hello #1"}');
  });

  it('escapes what JSON has to escape', () => {
    expect(messagePayload('a "b"\nc')).toBe('{"data":"a \\"b\\"\\nc"}');
    expect(loadPayload('https://x/?q=a b')).toBe('{"src":"https://x/?q=a b"}');
  });
});

describe('LoadCycle', () => {
  it('reports one terminal event per load', () => {
    const cycle = new LoadCycle();
    const generation = cycle.begin();
    expect(cycle.finish(generation)).toBe(true);
    // a second result for the same load — say error after load — is dropped
    expect(cycle.finish(generation)).toBe(false);
  });

  it('drops the previous page result after the src changes', () => {
    const cycle = new LoadCycle();
    const first = cycle.begin();
    const second = cycle.begin();
    expect(cycle.finish(first)).toBe(false);
    expect(cycle.finish(second)).toBe(true);
  });

  it('accepts messages only from the current page', () => {
    const cycle = new LoadCycle();
    const first = cycle.begin();
    expect(cycle.accepts(first)).toBe(true);
    const second = cycle.begin();
    expect(cycle.accepts(first)).toBe(false);
    expect(cycle.accepts(second)).toBe(true);
  });

  it('does not let a message settle the load', () => {
    const cycle = new LoadCycle();
    const generation = cycle.begin();
    cycle.accepts(generation);
    expect(cycle.finish(generation)).toBe(true);
  });
});
