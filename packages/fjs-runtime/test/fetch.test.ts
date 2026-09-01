// fetch over the native host: request encoding, the response event, aborts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

interface HostCall {
  name: string;
  args: unknown[];
}

const calls: HostCall[] = [];

// host.ts reads __fjs at module load, so this has to be installed before the
// dynamic import below.
(globalThis as Record<string, unknown>).__fjs = {
  fns: {
    setTimeout: (cb: () => void, ms: number) => Number(setTimeout(cb, ms)),
    clearTimeout: (id: number) => clearTimeout(id),
    setInterval: (cb: () => void, ms: number) => Number(setInterval(cb, ms)),
    clearInterval: (id: number) => clearInterval(id),
    uiOps: () => {},
    invokeHost: (name: string, ...args: unknown[]) => {
      calls.push({ name, args });
      return null;
    },
    nowMs: () => Date.now(),
    toast: () => {},
    engine: { engineId: 'test', abiVersion: 1 },
  },
  natives: {},
  engine: { engineId: 'test', abiVersion: 1 },
};

const mod = await import('../src/net/fetch');
const { base64Encode } = await import('../src/net/base64');
const { utf8Encode } = await import('../src/ui/utf8');

const { fetch, FjsAbortController } = mod;

type Dispatch = (nodeId: number, eventType: number, payload: string | null) => void;

function respond(payload: Record<string, unknown>): void {
  const last = calls[calls.length - 1];
  const id = last.args[0] as number;
  (globalThis as { __fjsDispatchEvent?: Dispatch }).__fjsDispatchEvent!(
    id,
    14,
    JSON.stringify(payload),
  );
}

function body(text: string): string {
  return base64Encode(utf8Encode(text));
}

beforeEach(() => {
  calls.length = 0;
});

describe('fetch', () => {
  it('sends the request through invokeHost and resolves on the event', async () => {
    const promise = fetch('https://example.com/api', {
      method: 'post',
      headers: { 'Content-Type': 'application/json' },
      body: '{"a":1}',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('fjs.http.request');
    const spec = JSON.parse(calls[0].args[1] as string);
    expect(spec.url).toBe('https://example.com/api');
    expect(spec.method).toBe('POST');
    expect(spec.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(spec.bodyBase64).toBe(body('{"a":1}'));
    expect(spec.followRedirects).toBe(true);

    respond({
      ok: true,
      status: 200,
      statusText: 'OK',
      url: 'https://example.com/api',
      headers: { 'content-type': 'application/json' },
      bodyBase64: body('{"hello":"世界"}'),
    });

    const res = await promise;
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(await res.json()).toEqual({ hello: '世界' });
  });

  it('resolves 4xx instead of rejecting, like the web', async () => {
    const promise = fetch('https://example.com/missing');
    respond({ ok: true, status: 404, statusText: 'Not Found', bodyBase64: body('nope') });
    const res = await promise;
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('nope');
  });

  it('rejects when the host reports a transport failure', async () => {
    const promise = fetch('https://nowhere.invalid/');
    respond({ ok: false, error: 'network error: failed host lookup' });
    await expect(promise).rejects.toThrow(/failed host lookup/);
  });

  it('aborts through the host and rejects the promise', async () => {
    const controller = new FjsAbortController();
    const promise = fetch('https://example.com/slow', { signal: controller.signal });
    const rejected = expect(promise).rejects.toThrow(/aborted/);
    controller.abort();
    await rejected;
    expect(calls.map((c) => c.name)).toEqual(['fjs.http.request', 'fjs.http.abort']);

    // a response that lost the race must not resurrect the promise
    expect(() => respond({ ok: true, status: 200 })).not.toThrow();
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new FjsAbortController();
    controller.abort();
    await expect(
      fetch('https://example.com/', { signal: controller.signal }),
    ).rejects.toThrow(/aborted/);
    expect(calls).toHaveLength(0);
  });

  it('round-trips binary bodies as bytes', async () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128]);
    const promise = fetch('https://example.com/blob', { method: 'PUT', body: bytes });
    const spec = JSON.parse(calls[0].args[1] as string);
    expect(spec.bodyBase64).toBe(base64Encode(bytes));
    respond({ ok: true, status: 200, bodyBase64: base64Encode(bytes) });
    const res = await promise;
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual(Array.from(bytes));
  });

  it('installs the globals the host has none of', () => {
    expect(typeof (globalThis as { fetch?: unknown }).fetch).toBe('function');
    expect(typeof (globalThis as { AbortController?: unknown }).AbortController).toBe(
      'function',
    );
  });
});

describe('Headers', () => {
  it('is case-insensitive and joins repeats', () => {
    const h = new mod.FjsHeaders({ Accept: 'text/plain' });
    h.append('accept', 'text/html');
    h.set('X-Token', 'abc');
    expect(h.get('ACCEPT')).toBe('text/plain, text/html');
    expect(h.has('x-token')).toBe(true);
    h.delete('x-token');
    expect(h.get('X-Token')).toBeNull();
  });
});

describe('utf8 without TextDecoder', () => {
  // the branch QuickJS actually takes — node always has TextDecoder
  const real = globalThis.TextDecoder;
  afterEach(() => {
    globalThis.TextDecoder = real;
  });

  it('decodes 1-4 byte sequences and replaces malformed ones', async () => {
    const { utf8Decode } = await import('../src/ui/utf8');
    const text = 'a é 世 \u{1F600} end';
    // @ts-expect-error removing it is the point
    delete globalThis.TextDecoder;
    expect(utf8Decode(utf8Encode(text))).toBe(text);
    expect(utf8Decode(new Uint8Array([0xff, 0x41]))).toBe('\uFFFDA');
    // a long body crosses the 4096-char chunk boundary
    const long = 'é世'.repeat(5000);
    expect(utf8Decode(utf8Encode(long))).toBe(long);
  });
});

describe('base64', () => {
  it('round-trips every byte value, at each length remainder', async () => {
    for (const len of [0, 1, 2, 3, 255, 256, 257]) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = i % 256;
      const decoded = (await import('../src/net/base64')).base64Decode(base64Encode(bytes));
      expect(Array.from(decoded)).toEqual(Array.from(bytes));
    }
  });

  it('matches the platform encoder', () => {
    const bytes = utf8Encode('héllo, 世界 — ok');
    expect(base64Encode(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });
});
