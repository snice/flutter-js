// specs/049: Worker on the mini program (wx.createWorker, one at a time).
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeWxWorker {
  path: string;
  posted: unknown[];
  terminated: boolean;
  listener: ((m: { d?: unknown; e?: unknown }) => void) | null;
}
const workers: FakeWxWorker[] = [];
vi.stubGlobal('wx', {
  createWorker(path: string) {
    const w: FakeWxWorker = { path, posted: [], terminated: false, listener: null };
    workers.push(w);
    return {
      postMessage: (m: unknown) => w.posted.push(m),
      onMessage: (cb: FakeWxWorker['listener']) => (w.listener = cb),
      terminate: () => (w.terminated = true),
    };
  },
});

import { Worker } from '../src/wx/worker';

beforeEach(() => {
  workers.length = 0;
});

describe('wx Worker', () => {
  it('creates from the project-root path and passes strings as { d }', () => {
    const w = new Worker('/workers/sqrt.js');
    expect(workers[0].path).toBe('workers/sqrt.js');
    w.postMessage('3000000');
    expect(workers[0].posted).toEqual([{ d: '3000000' }]);
    const got: string[] = [];
    const errors: string[] = [];
    w.onmessage = (e) => got.push(e.data);
    w.onerror = (m) => errors.push(m);
    workers[0].listener!({ d: '42' });
    workers[0].listener!({ e: 'boom' });
    expect(got).toEqual(['42']);
    expect(errors).toEqual(['boom']);
    w.terminate();
    expect(workers[0].terminated).toBe(true);
  });

  it('a second worker terminates the live one and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    new Worker('/workers/a.js');
    new Worker('/workers/b.js');
    new Worker('/workers/c.js');
    expect(workers.map((w) => w.terminated)).toEqual([true, true, false]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('rejects a code string', () => {
    expect(() => new Worker('postMessage(1)')).toThrow(/worker file path/);
    expect(workers).toHaveLength(0);
  });
});
