// invokeHostAsync over the native host: the wire shape of the synchronous
// initiation, the settlement event, and the loud-failure paths (no host,
// bad args, handler errors). Same mock-the-host-at-load technique as
// fetch.test.ts — host.ts reads __fjs at module load.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface HostCall {
  name: string;
  args: unknown[];
}

const calls: HostCall[] = [];

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

const { invokeHostAsync } = await import('../src/host-async');
const { installEventDispatcher } = await import('../src/ui/element');

type Dispatch = (nodeId: number, eventType: number, payload: string | null) => void;

function dispatch(id: number, payload: unknown): void {
  (globalThis as { __fjsDispatchEvent?: Dispatch }).__fjsDispatchEvent!(
    id,
    32,
    typeof payload === 'string' ? payload : JSON.stringify(payload),
  );
}

function lastCallId(): number {
  const last = calls[calls.length - 1];
  return last.args[0] as number;
}

beforeEach(() => {
  calls.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('invokeHostAsync', () => {
  it('initiates through invokeHost with a single JSON args array and resolves on the event', async () => {
    installEventDispatcher();
    const promise = invokeHostAsync<{ name: string }>('user.profile', 42, 'full', { deep: true });

    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('fjs.async.invoke');
    expect(calls[0].args[0]).toBeTypeOf('number');
    expect(calls[0].args[1]).toBe('user.profile');
    expect(JSON.parse(calls[0].args[2] as string)).toEqual([42, 'full', { deep: true }]);

    dispatch(lastCallId(), { ok: true, value: { name: 'zt' } });
    await expect(promise).resolves.toEqual({ name: 'zt' });
  });

  it('resolves concurrent calls by their own call ids', async () => {
    installEventDispatcher();
    const first = invokeHostAsync<string>('m.slow', 'a');
    const second = invokeHostAsync<string>('m.slow', 'b');
    const third = invokeHostAsync<string>('m.slow', 'c');

    expect(calls).toHaveLength(3);
    const ids = calls.map((c) => c.args[0] as number);
    expect(new Set(ids).size).toBe(3);

    dispatch(ids[1], { ok: true, value: 'B' });
    dispatch(ids[2], { ok: true, value: 'C' });
    dispatch(ids[0], { ok: true, value: 'A' });
    await expect(first).resolves.toBe('A');
    await expect(second).resolves.toBe('B');
    await expect(third).resolves.toBe('C');
  });

  it('rejects with the errMsg from the failure payload', async () => {
    installEventDispatcher();
    const promise = invokeHostAsync('m.boom');
    dispatch(lastCallId(), { ok: false, errMsg: 'host module "m.boom" threw: nope' });
    await expect(promise).rejects.toThrow('host module "m.boom" threw: nope');
  });

  it('resolves null as null (Dart has no undefined)', async () => {
    installEventDispatcher();
    const promise = invokeHostAsync('m.nothing');
    dispatch(lastCallId(), { ok: true, value: null });
    await expect(promise).resolves.toBeNull();
  });

  it('rejects on a malformed payload instead of resolving undefined', async () => {
    installEventDispatcher();
    const promise = invokeHostAsync('m.junk');
    dispatch(lastCallId(), 'not-json{');
    await expect(promise).rejects.toThrow(/malformed result payload/);
  });

  it('rejects when the arguments are not JSON-encodable', async () => {
    installEventDispatcher();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(invokeHostAsync('m.any', circular)).rejects.toThrow(/not JSON-encodable/);
    expect(calls).toHaveLength(0);
  });

  it('rejects when invokeHost itself throws, and leaves no pending entry', async () => {
    installEventDispatcher();
    const original = (globalThis as Record<string, unknown>).__fjs as Record<string, unknown>;
    const fns = original.fns as Record<string, unknown>;
    fns.invokeHost = () => {
      throw new Error('engine gone');
    };
    try {
      await expect(invokeHostAsync('m.any')).rejects.toThrow(/invokeHostAsync.*engine gone/);
    } finally {
      fns.invokeHost = (name: string, ...args: unknown[]) => {
        calls.push({ name, args });
        return null;
      };
    }
  });

  it('drops a settlement for an unknown call id (late dispatch after a VM rebuild)', () => {
    installEventDispatcher();
    expect(() => dispatch(999_999, { ok: true, value: 'ghost' })).not.toThrow();
  });
});

describe('invokeHostAsync without a native host', () => {
  it('rejects loudly instead of hanging', async () => {
    vi.resetModules();
    delete (globalThis as Record<string, unknown>).__fjs;
    try {
      const { invokeHostAsync: noHost } = await import('../src/host-async');
      await expect(noHost('m.any')).rejects.toThrow(/no native host/);
    } finally {
      // other suites read __fjs at their own module load; restore the shape
      (globalThis as Record<string, unknown>).__fjs = {
        fns: {
          invokeHost: (name: string, ...args: unknown[]) => {
            calls.push({ name, args });
            return null;
          },
          engine: { engineId: 'test', abiVersion: 1 },
        },
      };
    }
  });
});
