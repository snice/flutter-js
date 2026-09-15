/******************************************************************************
 * Spine Runtimes License Agreement
 * Last updated April 5, 2025. Replaces all prior versions.
 *
 * Copyright (c) 2013-2025, Esoteric Software LLC
 *
 * Integration of the Spine Runtimes into software or otherwise creating
 * derivative works of the Spine Runtimes is permitted under the terms and
 * conditions of Section 2 of the Spine Editor License Agreement:
 * http://esotericsoftware.com/spine-editor-license
 *
 * Otherwise, it is permitted to integrate the Spine Runtimes into software
 * or otherwise create derivative works of the Spine Runtimes (collectively,
 * "Products"), provided that each user of the Products must obtain their own
 * Spine Editor license and redistribution of the Products in any form must
 * include this license and copyright notice.
 *
 * THE SPINE RUNTIMES ARE PROVIDED BY ESOTERIC SOFTWARE LLC "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL ESOTERIC SOFTWARE LLC BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES,
 * BUSINESS INTERRUPTION, OR LOSS OF USE, DATA, OR PROFITS) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THE SPINE RUNTIMES, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *****************************************************************************/

// fjs port of spine-canvas' AssetManager.
//
// spine-core's loaders are browser-shaped: text and binaries go through
// XMLHttpRequest, textures through `new Image()` (or fetch + createImageBitmap
// when it decides it is in a worker — which is what it concludes on the app,
// where there is no `window`). None of those exist on the app. Rather than
// polyfill DOM globals for every page, the two I/O points are swapped for the
// runtime's own:
//
//   text / binary  fetch() from @ufjs/runtime — root-relative paths answer
//                  from the dev server or the release bundle on the app, the
//                  browser's fetch on web
//   textures       loadCanvasImage() — the only image a fjs 2d context can
//                  draw (a host handle on the app, HTMLImageElement on web)
//
// Everything else (atlas parsing, ref counting, the cache, loadAll) stays in
// AssetManagerBase untouched.
import {
  type AssetCache,
  AssetManagerBase,
  Downloader,
  Texture,
} from '@esotericsoftware/spine-core';
import { fetch, loadCanvasImage, type FjsCanvasImageSource } from '@ufjs/runtime';

import { CanvasTexture } from './CanvasTexture';

type SuccessCallback<T> = (data: T) => void;
type ErrorCallback = (status: number, responseText: string) => void;

/** Downloader over the runtime's fetch. Keeps upstream's contract: concurrent
 * requests for one URL share a single download, and `rawDataUris` entries
 * that are real data URIs are decoded without touching the network. */
export class FjsDownloader extends Downloader {
  private inflight = new Map<string, Array<[SuccessCallback<never>, ErrorCallback]>>();

  override downloadText(url: string, success: SuccessCallback<string>, error: ErrorCallback): void {
    const raw = this.rawDataUris[url];
    // upstream's rule: a raw data uri containing "." rewrites the URL instead
    if (raw && !raw.includes('.')) return super.downloadText(url, success, error);
    this.download(url, raw || url, (response) => response.text(), success, error);
  }

  override downloadBinary(url: string, success: SuccessCallback<Uint8Array>, error: ErrorCallback): void {
    const raw = this.rawDataUris[url];
    if (raw && !raw.includes('.')) return super.downloadBinary(url, success, error);
    this.download(
      url,
      raw || url,
      (response) => response.arrayBuffer().then((buffer) => new Uint8Array(buffer)),
      success,
      error,
    );
  }

  private download<T>(
    key: string,
    url: string,
    read: (response: { text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }) => Promise<T>,
    success: SuccessCallback<T>,
    error: ErrorCallback,
  ): void {
    const waiting = this.inflight.get(key);
    if (waiting) {
      waiting.push([success as SuccessCallback<never>, error]);
      return;
    }
    const callbacks: Array<[SuccessCallback<never>, ErrorCallback]> = [[success as SuccessCallback<never>, error]];
    this.inflight.set(key, callbacks);
    const finish = (ok: boolean, status: number, data: unknown) => {
      this.inflight.delete(key);
      for (const [onSuccess, onError] of callbacks) {
        if (ok) (onSuccess as SuccessCallback<unknown>)(data);
        else onError(status, String(data));
      }
    };
    fetch(url)
      .then(async (response) => {
        // a missing file on a SPA dev server is a 200 index.html; nothing to
        // detect there, but a real error status must not be parsed as data
        if (!response.ok) return finish(false, response.status, await response.text().catch(() => ''));
        finish(true, response.status, await read(response));
      })
      .catch((e: unknown) => finish(false, 0, e instanceof Error ? e.message : e));
  }
}

/** The AssetManagerBase members loadTexture needs. They are TypeScript-private
 * upstream but plain properties at runtime; spine-core is pinned to an exact
 * version in package.json so this shape cannot drift under us. */
interface BaseInternals {
  cache: AssetCache;
  texturePmaInfo: Record<string, boolean>;
  start(path: string): string;
  success<T>(callback: ((path: string, data: T) => void) | undefined, path: string, asset: T): void;
  error(callback: ((path: string, message: string) => void) | undefined, path: string, message: string): void;
  createTexture(path: string, pma: boolean, image: FjsCanvasImageSource): Texture;
}

function isRawImage(data: unknown): data is FjsCanvasImageSource {
  return (
    !!data &&
    typeof data === 'object' &&
    !(data instanceof Texture) &&
    typeof (data as { width?: unknown }).width === 'number' &&
    typeof (data as { height?: unknown }).height === 'number'
  );
}

/** Upstream's reuseAssets checks `data instanceof Image`, which throws a
 * ReferenceError on the app the first time an asset is requested twice.
 * Same logic, duck-typed; installed over the base method below because a
 * subclass cannot redeclare a TypeScript-private member. */
function reuseAssets<T>(
  this: AssetManagerBase,
  path: string,
  success: (path: string, data: T) => void = () => {},
  error: (path: string, message: string) => void = () => {},
): boolean {
  const self = this as unknown as BaseInternals;
  const loaded = self.cache.getAsset(path);
  if (loaded === undefined) return false;
  self.cache.assetsLoaded[path] = loaded
    .then((data) => {
      const asset = (isRawImage(data) ? new CanvasTexture(data) : data) as T;
      self.success(success, path, asset);
      return asset as never;
    })
    .catch((message: string) => {
      self.error(error, path, message);
      return undefined;
    });
  return true;
}

export class AssetManager extends AssetManagerBase {
  constructor(pathPrefix = '', downloader: Downloader = new FjsDownloader()) {
    super((image) => new CanvasTexture(image as FjsCanvasImageSource), pathPrefix, downloader);
  }

  override loadTexture(
    path: string,
    success: (path: string, texture: Texture) => void = () => {},
    error: (path: string, message: string) => void = () => {},
  ): void {
    const self = this as unknown as BaseInternals;
    path = self.start(path);
    if ((reuseAssets<Texture>).call(this, path, success, error)) return;

    const pma = self.texturePmaInfo[path];
    const rawDataUris = (this as unknown as { downloader: Downloader }).downloader.rawDataUris;
    self.cache.assetsLoaded[path] = new Promise<Texture>((resolve, reject) => {
      loadCanvasImage(
        rawDataUris[path] ?? path,
        (image) => {
          const texture = self.createTexture(path, pma, image);
          self.success(success, path, texture);
          resolve(texture);
        },
        (reason) => {
          const message = `Couldn't load image: ${path} (${reason})`;
          self.error(error, path, message);
          reject(message);
        },
      );
    });
  }
}

Object.defineProperty(AssetManager.prototype, 'reuseAssets', {
  value: reuseAssets,
  writable: true,
  configurable: true,
});
