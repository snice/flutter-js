// Worker — a real background thread, started from a worker FILE (specs/049).
//
// Main thread:
//   import { Worker } from 'fjs';
//   const w = new Worker('/workers/sqrt.js');   // src/workers/sqrt.ts
//   w.onmessage = (e) => console.log(e.data);
//   w.onerror = (message) => console.error(message);
//   w.postMessage('start');
//   w.terminate();
//
// Worker file (src/workers/<rel>.ts|js, bundled by the fjs build into
// /workers/<rel>.js, local imports inlined): globals onmessage (settable),
// postMessage(msg), console, timers. Messages are strings (JSON.stringify for
// structured payloads).
//
// Why a path and not a code string (what this took before): the mini program
// can only start a worker from a real file under app.json "workers" and has
// no eval, so the three ends share the file convention instead of each
// running strings their own way.
//
//   Flutter  the script is fetched by its root path — from the dev server, or
//            from the release bundle's assets/fjs/public, the same resolution
//            images and public/ files get (flutter_fjs http.dart) — then handed
//            to a Dart isolate with its own QuickJS runtime
//            (js.worker.create, unchanged). Messages posted before the
//            script arrives are queued.
//   web      the path is the URL of a real DOM Worker.
//   mp       wx/worker.ts (wx.createWorker).
import { fetch as fjsFetch } from './net/fetch';
import { hasNativeHost, invokeHost } from './host';
import { registerWorkerHandler, unregisterWorkerHandler } from './ui/element';
import { checkWorkerPath } from './worker-path';

interface DomWorker {
  postMessage(message: string): void;
  terminate(): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: { message?: string }) => void) | null;
}

type DomWorkerCtor = new (url: string) => DomWorker;

function domWorkerCtor(): DomWorkerCtor | null {
  const g = globalThis as unknown as { Worker?: DomWorkerCtor };
  return !hasNativeHost && typeof g.Worker === 'function' ? g.Worker : null;
}

export class Worker {
  id = 0;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: ((e: string) => void) | null = null;

  private dom: DomWorker | null = null;
  /** Flutter: posts made before the script arrived */
  private pending: string[] | null = null;
  private terminated = false;

  constructor(path: string) {
    const url = checkWorkerPath(path);
    const Ctor = domWorkerCtor();
    if (Ctor) {
      const worker = new Ctor(url);
      worker.onmessage = (e) => this.onmessage?.({ data: String(e.data) });
      worker.onerror = (e) => this.fail(String(e?.message ?? `worker ${url} failed to load`));
      this.dom = worker;
      return;
    }
    this.pending = [];
    fjsFetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`worker ${url}: HTTP ${res.status}`);
        return res.text();
      })
      .then((code) => {
        if (this.terminated) return;
        const result = invokeHost<number>('js.worker.create', code);
        this.id = typeof result === 'number' ? result : Number(result);
        registerWorkerHandler(this.id, (data) => {
          this.onmessage?.({ data });
        });
        const queued = this.pending ?? [];
        this.pending = null;
        for (const message of queued) invokeHost('js.worker.post', this.id, message);
      })
      .catch((err: unknown) => {
        if (!this.terminated) this.fail(err instanceof Error ? err.message : String(err));
      });
  }

  postMessage(message: string): void {
    if (this.terminated) return;
    const text = String(message);
    if (this.dom) {
      this.dom.postMessage(text);
      return;
    }
    if (this.pending) {
      this.pending.push(text);
      return;
    }
    invokeHost('js.worker.post', this.id, text);
  }

  terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    if (this.dom) {
      this.dom.terminate();
      this.dom = null;
      return;
    }
    if (this.pending) {
      // the script has not arrived: nothing was created on the host yet
      this.pending = null;
      return;
    }
    unregisterWorkerHandler(this.id);
    invokeHost('js.worker.terminate', this.id);
  }

  private fail(message: string): void {
    if (this.onerror) this.onerror(message);
    else console.error(`[fjs] Worker: ${message}`);
  }
}
