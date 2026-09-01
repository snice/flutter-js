// The web path: no native host, so fetch forwards to the browser's — but
// `timeout` and the runtime's own AbortController are things the browser has
// never heard of, and both have to keep working for one source to run on
// both targets. Separate file from fetch.test.ts because whether a native
// host exists is decided once, at module load.
import { describe, expect, it, vi } from 'vitest';

interface Seen {
  url: string;
  init: { signal?: { aborted: boolean; addEventListener(t: string, l: () => void): void } };
}

const seen: Seen[] = [];

// a fetch that never settles on its own — only aborting ends it
(globalThis as Record<string, unknown>).fetch = (url: string, init: Seen['init']) => {
  seen.push({ url, init });
  return new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => {
      reject(new Error('aborted by signal'));
    });
  });
};

const { fetch, FjsAbortController } = await import('../src/net/fetch');

describe('fetch on web', () => {
  it('passes a plain request straight through', async () => {
    const g = globalThis as unknown as { fetch: (u: string, i?: unknown) => Promise<unknown> };
    const spy = vi.spyOn(g, 'fetch');
    void fetch('https://example.com/plain', { method: 'GET' });
    expect(spy.mock.calls[0][0]).toBe('https://example.com/plain');
    // no signal invented where the caller asked for none
    expect((spy.mock.calls[0][1] as { signal?: unknown }).signal).toBeUndefined();
    spy.mockRestore();
  });

  it('turns the timeout extension into a real aborted signal', async () => {
    vi.useFakeTimers();
    const promise = fetch('https://example.com/slow', { timeout: 1000 });
    const rejected = expect(promise).rejects.toThrow(/aborted by signal/);
    vi.advanceTimersByTime(1000);
    await rejected;
    vi.useRealTimers();
  });

  it("bridges the runtime's own AbortController onto a DOM signal", async () => {
    const ctrl = new FjsAbortController();
    const promise = fetch('https://example.com/slow', { signal: ctrl.signal });
    const before = seen[seen.length - 1].init.signal;
    // what reached the browser is a real AbortSignal, not the fjs one
    expect(before).not.toBe(ctrl.signal);
    const rejected = expect(promise).rejects.toThrow(/aborted by signal/);
    ctrl.abort();
    await rejected;
  });

  it('rejects an already-aborted signal without hanging', async () => {
    const ctrl = new FjsAbortController();
    ctrl.abort();
    await expect(
      fetch('https://example.com/slow', { signal: ctrl.signal }),
    ).rejects.toThrow(/aborted/);
  });
});
