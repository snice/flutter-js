// Worker — a real background thread. Backed by a Dart isolate owning an
// independent QuickJS runtime, so heavy JS never blocks the UI thread.
//
// Main thread:
//   import { Worker } from 'fjs';
//   const w = new Worker(fibCode);        // code: string (esbuild 多入口或模板串)
//   w.onmessage = (e) => console.log(e.data);
//   w.postMessage('start');
//   w.terminate();
//
// Worker code globals: onmessage (settable), postMessage(msg), console, timers.
// Messages are strings (JSON.stringify for structured payloads).
//
// Building worker code: give esbuild a second entry (format: 'iife') and
// inline it, e.g. `import workerCode from './worker-entry.ts?text'`-style
// loaders, or keep worker sources as plain strings in v1.
//
// On web there is no native host: the same class runs the same code string
// in a real DOM Worker, so a page using Worker works on both platforms.
import { hasNativeHost, invokeHost } from './host';
import { registerWorkerHandler, unregisterWorkerHandler } from './ui/element';

interface DomWorker {
  postMessage(message: string): void;
  terminate(): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: { message?: string }) => void) | null;
}

type DomWorkerCtor = new (url: string) => DomWorker;

function domWorkerCtor(): DomWorkerCtor | null {
  const g = globalThis as unknown as { Worker?: DomWorkerCtor; URL?: typeof URL };
  return !hasNativeHost && typeof g.Worker === 'function' && g.URL ? g.Worker : null;
}

export class Worker {
  readonly id: number;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: ((e: string) => void) | null = null;

  private dom: DomWorker | null = null;
  private domUrl = '';

  constructor(code: string) {
    const Ctor = domWorkerCtor();
    if (Ctor) {
      this.domUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      const worker = new Ctor(this.domUrl);
      worker.onmessage = (e) => this.onmessage?.({ data: String(e.data) });
      worker.onerror = (e) => this.onerror?.(String(e.message ?? e));
      this.dom = worker;
      this.id = 0;
      return;
    }
    const result = invokeHost<number>('js.worker.create', code);
    this.id = typeof result === 'number' ? result : Number(result);
    registerWorkerHandler(this.id, (data) => {
      this.onmessage?.({ data });
    });
  }

  postMessage(message: string): void {
    if (this.dom) {
      this.dom.postMessage(message);
      return;
    }
    invokeHost('js.worker.post', this.id, message);
  }

  terminate(): void {
    if (this.dom) {
      this.dom.terminate();
      URL.revokeObjectURL(this.domUrl);
      this.dom = null;
      return;
    }
    unregisterWorkerHandler(this.id);
    invokeHost('js.worker.terminate', this.id);
  }
}
