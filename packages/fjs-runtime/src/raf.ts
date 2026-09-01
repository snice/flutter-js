import { hasNativeHost, invokeHost, nowMs } from './host';
import { registerSystemHandler } from './ui/element';

const EVENT_RAF = 19;

type FrameRequestCallback = (time: number) => void;

let nextId = 1;
const callbacks = new Map<number, FrameRequestCallback>();

function requestNativeAnimationFrame(cb: FrameRequestCallback): number {
  const id = nextId++;
  callbacks.set(id, cb);
  invokeHost('js.raf.request', id);
  return id;
}

function cancelNativeAnimationFrame(id: number): void {
  callbacks.delete(id);
}

if (hasNativeHost) {
  registerSystemHandler(EVENT_RAF, (id, payload) => {
    const cb = callbacks.get(id);
    if (!cb) return;
    callbacks.delete(id);
    cb(payload == null ? nowMs() : Number(payload));
  });

  const g = globalThis as Record<string, unknown>;
  if (typeof g.requestAnimationFrame !== 'function') {
    g.requestAnimationFrame = requestNativeAnimationFrame;
  }
  if (typeof g.cancelAnimationFrame !== 'function') {
    g.cancelAnimationFrame = cancelNativeAnimationFrame;
  }
}
