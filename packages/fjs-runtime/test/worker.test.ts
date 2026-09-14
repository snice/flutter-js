// specs/049: Worker takes a worker file path on every target.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hostState = vi.hoisted(() => ({ native: true, calls: [] as unknown[][], nextId: 7 }));
const fetchState = vi.hoisted(() => ({ result: null as null | (() => Promise<unknown>) }));
const handlers = vi.hoisted(() => new Map<number, (data: string) => void>());

vi.mock('../src/host', () => ({
  get hasNativeHost() {
    return hostState.native;
  },
  invokeHost: (name: string, ...args: unknown[]) => {
    hostState.calls.push([name, ...args]);
    return name === 'js.worker.create' ? hostState.nextId : undefined;
  },
}));
vi.mock('../src/net/fetch', () => ({ fetch: () => fetchState.result!() }));
vi.mock('../src/ui/element', () => ({
  registerWorkerHandler: (id: number, fn: (data: string) => void) => handlers.set(id, fn),
  unregisterWorkerHandler: (id: number) => handlers.delete(id),
}));

import { Worker } from '../src/worker';

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  hostState.calls = [];
  handlers.clear();
});

describe('Worker path', () => {
  it('rejects a code string with the new way to write it', () => {
    expect(() => new Worker('onmessage = function () {}')).toThrow(/src\/workers\/<name>\.ts.*\/workers\/<name>\.js/);
    expect(() => new Worker('/elsewhere/a.js')).toThrow();
    expect(() => new Worker('/workers/a.ts')).toThrow();
  });
});

describe('Worker on Flutter (native host)', () => {
  beforeEach(() => {
    hostState.native = true;
  });

  it('fetches the script, creates the worker, then sends what was queued', async () => {
    fetchState.result = async () => ({ ok: true, status: 200, text: async () => 'CODE' });
    const w = new Worker('/workers/sqrt.js');
    w.postMessage('1');
    w.postMessage('2');
    expect(hostState.calls).toEqual([]);
    await flush();
    expect(hostState.calls).toEqual([
      ['js.worker.create', 'CODE'],
      ['js.worker.post', 7, '1'],
      ['js.worker.post', 7, '2'],
    ]);
    const got: string[] = [];
    w.onmessage = (e) => got.push(e.data);
    handlers.get(7)!('done');
    expect(got).toEqual(['done']);
    w.postMessage('3');
    expect(hostState.calls.at(-1)).toEqual(['js.worker.post', 7, '3']);
    w.terminate();
    expect(hostState.calls.at(-1)).toEqual(['js.worker.terminate', 7]);
    expect(handlers.has(7)).toBe(false);
  });

  it('a script that fails to load reports to onerror', async () => {
    fetchState.result = async () => ({ ok: false, status: 404, text: async () => '' });
    const w = new Worker('/workers/missing.js');
    const errors: string[] = [];
    w.onerror = (m) => errors.push(m);
    await flush();
    expect(errors).toEqual(['worker /workers/missing.js: HTTP 404']);
    expect(hostState.calls).toEqual([]);
  });

  it('terminate before the script arrives creates nothing', async () => {
    fetchState.result = async () => ({ ok: true, status: 200, text: async () => 'CODE' });
    const w = new Worker('/workers/sqrt.js');
    w.terminate();
    await flush();
    expect(hostState.calls).toEqual([]);
  });
});

describe('Worker on the web (DOM Worker)', () => {
  let created: Array<{ url: string; posted: string[]; terminated: boolean; onmessage: any; onerror: any }>;
  beforeEach(() => {
    hostState.native = false;
    created = [];
    vi.stubGlobal(
      'Worker',
      class {
        url: string;
        posted: string[] = [];
        terminated = false;
        onmessage: any = null;
        onerror: any = null;
        constructor(url: string) {
          this.url = url;
          created.push(this);
        }
        postMessage(m: string) {
          this.posted.push(m);
        }
        terminate() {
          this.terminated = true;
        }
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('uses the path as the DOM Worker URL', () => {
    const w = new Worker('/workers/sqrt.js');
    const got: string[] = [];
    w.onmessage = (e) => got.push(e.data);
    w.postMessage('3000000');
    expect(created[0].url).toBe('/workers/sqrt.js');
    expect(created[0].posted).toEqual(['3000000']);
    created[0].onmessage({ data: 42 });
    expect(got).toEqual(['42']);
    w.terminate();
    expect(created[0].terminated).toBe(true);
  });
});
