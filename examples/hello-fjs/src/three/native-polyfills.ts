// Native-host polyfills for the DOM APIs three.js reaches for, installed
// only when the page runs on the QuickJS host (spec 023).
//
// Why a page-level module and not runtime globals: these are three.js's
// needs, not the element API's. `Blob`, `URL.createObjectURL` and
// `createImageBitmap` exist to satisfy one specific pipeline — GLTFLoader
// hands embedded texture bytes to ImageBitmapLoader through a blob URL —
// and each piece maps onto machinery the runtime already has:
//
//   Blob                    a byte bucket in module memory
//   URL.createObjectURL     a `blob:fjs/<n>` name for that bucket
//   fetch(blobUrl)          intercepted here, answered from the bucket
//   res.blob()              the bucket back as a Blob
//   createImageBitmap(blob) data: URL -> fjs.canvas.loadImage (host decodes)
//                           -> FjsCanvasImage, which gl.texImage2D /
//                           texSubImage2D accept as a source (spec 022's
//                           image-handle path)
//   TextDecoder             the runtime's utf8Decode
//   performance.now         the engine's nowMs
//
// On web none of this installs: every global already exists natively, and
// the same page source must hit those natives untouched (constitution I).
// Import this module BEFORE three — ESM hoists imports, so declaration
// order in the page file decides module execution order.
import {
  base64Encode,
  fetch as runtimeFetch,
  Headers as FjsHeaders,
  hasNativeHost,
  loadCanvasImage,
  utf8DecodeBytes,
} from 'fjs';

type BlobLike = { _bytes: Uint8Array; size: number; type: string };
type Globals = Record<string, unknown> & {
  Blob?: unknown;
  URL?: unknown;
  fetch?: unknown;
  Request?: unknown;
  Headers?: unknown;
  TextDecoder?: unknown;
  performance?: unknown;
  createImageBitmap?: unknown;
  self?: unknown;
};

if (hasNativeHost) {
  const g = globalThis as unknown as Globals;

  // -- self -------------------------------------------------------------------
  // three refers to the bare global (`self.URL` in GLTFLoader's blob path,
  // `self.requestAnimationFrame` in its animation loop) — QuickJS has no
  // alias. Point it at globalThis before anything of three's can run.
  g.self = globalThis;

  // -- performance ----------------------------------------------------------
  if (typeof g.performance === 'undefined') {
    g.performance = { now: () => __fjs!.fns.nowMs() };
  }

  // -- TextDecoder ----------------------------------------------------------
  // Only the utf-8 path: GLTFLoader decodes GLB magic, the JSON chunk and
  // attribute names, all utf-8 by format. `fatal`/`ignoreBOM` are ignored.
  if (typeof g.TextDecoder === 'undefined') {
    class FjsTextDecoder {
      constructor(label?: string) {
        const encoding = (label ?? 'utf-8').toLowerCase();
        if (encoding !== 'utf-8' && encoding !== 'utf8') {
          // say why rather than decode garbage (constitution V)
          console.warn(
            `TextDecoder: only utf-8 is supported, got "${label}"; decoding as utf-8.`,
          );
        }
      }
      decode(input?: ArrayBufferView | ArrayBuffer | null): string {
        if (input == null) return '';
        const view = ArrayBuffer.isView(input)
          ? new Uint8Array(
              input.buffer,
              input.byteOffset,
              input.byteLength,
            )
          : new Uint8Array(input as ArrayBuffer);
        // utf8DecodeBytes, NOT utf8Decode: the latter probes for a global
        // TextDecoder, sees this very class, and recurses until the stack
        // blows — the exact crash that GLTFLoader's JSON-chunk decode hit.
        return utf8DecodeBytes(view);
      }
    }
    g.TextDecoder = FjsTextDecoder;
  }

  // -- Blob + object URLs ---------------------------------------------------
  // Buckets live for the page's lifetime; GLTFLoader revokes its URLs, so
  // the table stays empty in steady state. The URL is never dereferenced by
  // the host — only this module's fetch sees it — so the scheme is free;
  // blob: cannot collide with a real endpoint, and it has to be `blob:`:
  // GLTFLoader's resolveURL passes data:/blob:/http URLs through untouched
  // and prefixes anything else with the model's directory.
  const blobs = new Map<string, BlobLike>();
  let nextBlobId = 1;

  if (typeof g.Blob === 'undefined') {
    class FjsBlob {
      constructor(parts?: BlobPart[], options?: { type?: string }) {
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (const part of parts ?? []) {
          const bytes = blobPartBytes(part);
          chunks.push(bytes);
          size += bytes.byteLength;
        }
        const all = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          all.set(chunk, offset);
          offset += chunk.byteLength;
        }
        this._bytes = all;
        this.size = size;
        this.type = options?.type ?? '';
      }
      readonly _bytes: Uint8Array;
      readonly size: number;
      readonly type: string;
    }
    g.Blob = FjsBlob;
  }

  const blobOf = (value: unknown): BlobLike | null => {
    const candidate = value as Partial<BlobLike> | null;
    return candidate && candidate._bytes instanceof Uint8Array
      ? (candidate as BlobLike)
      : null;
  };

  if (typeof g.URL === 'undefined' || typeof (g.URL as { createObjectURL?: unknown }).createObjectURL !== 'function') {
    class FjsURL {}
    const url = FjsURL as unknown as Record<string, unknown>;
    url.createObjectURL = (blob: unknown): string => {
      const name = `blob:fjs/${nextBlobId++}`;
      blobs.set(name, blobOf(blob)!);
      return name;
    };
    url.revokeObjectURL = (name: string): void => {
      blobs.delete(name);
    };
    g.URL = FjsURL;
  }

  // -- Request / Headers ------------------------------------------------------
  // FileLoader builds `new Request(url, { headers: new Headers(...) })`
  // before calling fetch. The shims only have to carry those through.
  if (typeof g.Headers === 'undefined') {
    g.Headers = FjsHeaders;
  }
  if (typeof g.Request === 'undefined') {
    class FjsRequest {
      constructor(input: string | { url: string }, init?: { headers?: unknown }) {
        this.url = typeof input === 'string' ? input : input.url;
        this.headers = new FjsHeaders(
          (init?.headers ?? {}) as ConstructorParameters<typeof FjsHeaders>[0],
        );
      }
      readonly url: string;
      readonly headers: FjsHeaders;
    }
    g.Request = FjsRequest;
  }

  // -- fetch ------------------------------------------------------------------
  // Wrap (do not replace) the runtime's fetch: blob URLs answer from the
  // bucket, everything else goes over fjs.http.request as usual. The
  // response is a plain object, not FjsResponse — blob() is the one method
  // the ImageBitmapLoader path needs, and FjsResponse has no blob().
  const urlOf = (input: unknown): string =>
    typeof input === 'string' ? input : String((input as { url: string }).url);
  g.fetch = (input: unknown, init?: unknown): Promise<unknown> => {
    const url = urlOf(input);
    if (!url.startsWith('blob:fjs/')) {
      return runtimeFetch(url, (init ?? {}) as Parameters<typeof runtimeFetch>[1]);
    }
    const record = blobs.get(url);
    if (!record) {
      return Promise.resolve({
        ok: false,
        status: 404,
        statusText: 'blob URL revoked',
        blob: () => Promise.reject(new TypeError(`revoked: ${url}`)),
        arrayBuffer: () => Promise.reject(new TypeError(`revoked: ${url}`)),
        text: () => Promise.reject(new TypeError(`revoked: ${url}`)),
      });
    }
    const bytes = record._bytes;
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      blob: () =>
        Promise.resolve(
          new (g.Blob as new (
            parts?: BlobPart[],
            options?: { type?: string },
          ) => BlobLike)([bytes.slice() as BlobPart], {
            type: record.type,
          }),
        ),
      arrayBuffer: () => Promise.resolve(bytes.slice().buffer),
      text: () => Promise.resolve(utf8DecodeBytes(bytes)),
    });
  };

  // -- createImageBitmap --------------------------------------------------------
  // The host decodes; JS never sees pixels. The result is an FjsCanvasImage,
  // which @ufjs/webgl's texImage2D/texSubImage2D accept as a source — the
  // same handle path spec 022 built for canvas drawImage. GLTFLoader only
  // awaits the promise, so the DOM's option bag (premultiplyAlpha et al) is
  // ignored rather than honored.
  if (typeof g.createImageBitmap === 'undefined') {
    g.createImageBitmap = (blob: unknown): Promise<unknown> => {
      const record = blobOf(blob);
      if (!record) {
        return Promise.reject(
          new TypeError('createImageBitmap: expected a Blob'),
        );
      }
      const mime = record.type || 'image/png';
      const dataUrl = `data:${mime};base64,${base64Encode(record._bytes)}`;
      return new Promise((resolve, reject) => {
        const image = loadCanvasImage(
          dataUrl,
          () => resolve(image),
          (message) => reject(new TypeError(`createImageBitmap: ${message}`)),
        );
      });
    };
  }
}

function blobPartBytes(part: BlobPart): Uint8Array<ArrayBuffer> {
  // a fresh copy with a plain-ArrayBuffer backing, which is also what the
  // DOM Blob spec copies into — callers never read the input again
  if (ArrayBuffer.isView(part)) {
    const out = new Uint8Array(part.byteLength);
    out.set(new Uint8Array(part.buffer, part.byteOffset, part.byteLength));
    return out;
  }
  return new Uint8Array(part as ArrayBuffer);
}
