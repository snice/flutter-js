// invokeHostAsync(): Promise-shaped host module calls. The sync invokeHost
// is a JSI host function — its return value IS the call's result — so a
// Dart handler that needs the event loop (plugins, permissions, any Future)
// has nowhere to put its answer. This is the fetch paradigm generalized
// (constitution II: no new C ABI for a new capability — invokeHost is a
// generic scalar pass-through, so only an event number is spent):
//
//   JS -> Dart   invokeHost('fjs.async.invoke', callId, name, argsJson)
//                (synchronous; Dart starts the work and returns)
//   Dart -> JS   dispatchEvent(callId, 32 /* asyncResult */, resultJson)
//
// args cross as ONE JSON array string, so the Dart handler's argument list
// has a single meaning — decoded JSON values — and a string arg can't be
// mistaken for a JSON'd object. Payload field order is fixed and the Dart
// side (engine.dart _sendAsyncResult) keeps it: success
// {"ok":true,"value":<JSON>}, failure {"ok":false,"errMsg":"…"} — "ok"
// first. A Dart null resolves as null here (Dart has no undefined to omit
// the key with).
//
// Without a native host (web, fjsrun) this rejects — the same boundary
// invokeHost throws at. Web-side async capabilities live in each module's
// own JS implementation (browser APIs), not in a fake registry here.
import { hasNativeHost, host, invokeHost } from './host';
import { registerSystemHandler } from './ui/element';

const EVENT_ASYNC_RESULT = 32;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
}

const pending = new Map<number, Pending>();
let nextCallId = 1;
let dispatcherReady = false;

function ensureDispatcher(): void {
  if (dispatcherReady) return;
  dispatcherReady = true;
  registerSystemHandler(EVENT_ASYNC_RESULT, (id, payload) => {
    const entry = pending.get(id);
    // No entry: the VM was rebuilt (reload) after the call was made and the
    // pending map died with it, or the Dart side answered twice. Dropping is
    // the one silent path this channel allows — fetch does the same.
    if (!entry) return;
    pending.delete(id);
    let wire: { ok?: boolean; value?: unknown; errMsg?: string };
    try {
      wire = JSON.parse(payload ?? '{}') as typeof wire;
    } catch (e) {
      entry.reject(new Error(`invokeHostAsync: malformed result payload (${String(e)})`));
      return;
    }
    if (wire.ok === false || typeof wire.errMsg === 'string') {
      entry.reject(new Error(wire.errMsg ?? 'invokeHostAsync failed'));
      return;
    }
    entry.resolve(wire.value);
  });
}

/** Calls the Dart host module `name` and settles with whatever its Future
 * returns. Arguments must be JSON-encodable: scalars keep their value,
 * objects/arrays cross as JSON. Rejects when the module is not registered,
 * the handler throws, the value it returns is not JSON-encodable, or there
 * is no native host at all. */
export function invokeHostAsync<T = unknown>(name: string, ...args: unknown[]): Promise<T> {
  if (!hasNativeHost || !host) {
    return Promise.reject(
      new Error('invokeHostAsync: no native host (running outside fjs runtime)'),
    );
  }
  ensureDispatcher();
  const id = nextCallId++;
  let argsJson: string;
  try {
    argsJson = JSON.stringify(args);
  } catch (e) {
    return Promise.reject(
      new Error(`invokeHostAsync: arguments are not JSON-encodable (${String(e)})`),
    );
  }
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    try {
      invokeHost('fjs.async.invoke', id, name, argsJson);
    } catch (e) {
      pending.delete(id);
      reject(new Error(`invokeHostAsync: ${String(e)}`));
    }
  });
}
