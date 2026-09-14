// `Worker` on the mini program (specs/049): wx.createWorker over the worker
// files `fjs build --mp` writes to miniprogram/workers (project/workers.ts
// wraps each bundle so its onmessage / postMessage(string) talk to wx's
// `worker` global, strings travelling as { d }, errors as { e }).
//
// wx allows ONE live worker. Rather than make every page juggle that, a new
// Worker terminates the live one first and says so once (spec Q1) — pages
// should still terminate their worker when they go away.
import { checkWorkerPath } from '../worker-path';

interface WxWorker {
  postMessage(message: Record<string, unknown>): void;
  onMessage(cb: (message: { d?: unknown; e?: unknown }) => void): void;
  terminate(): void;
}

declare const wx: { createWorker(scriptPath: string): WxWorker };

let live: Worker | null = null;
let warnedReplace = false;

export class Worker {
  id = 0;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: ((e: string) => void) | null = null;

  private native: WxWorker | null;

  constructor(path: string) {
    const url = checkWorkerPath(path);
    if (live) {
      if (!warnedReplace) {
        warnedReplace = true;
        console.warn(
          `[fjs] Worker: the mini program runs one worker at a time — the live one was terminated to start ${url}. ` +
            'Terminate a worker when its page goes away.',
        );
      }
      live.terminate();
    }
    // wx takes the path from the project root without the leading slash
    this.native = wx.createWorker(url.slice(1));
    this.native.onMessage((message) => {
      if (message && message.e !== undefined) {
        const text = String(message.e);
        if (this.onerror) this.onerror(text);
        else console.error(`[fjs] Worker ${url}: ${text}`);
        return;
      }
      this.onmessage?.({ data: String(message?.d ?? '') });
    });
    live = this;
  }

  postMessage(message: string): void {
    this.native?.postMessage({ d: String(message) });
  }

  terminate(): void {
    if (!this.native) return;
    this.native.terminate();
    this.native = null;
    if (live === this) live = null;
  }
}
