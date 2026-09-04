// web-view — one tag, a platform WebView on the app and an iframe on the web.
//
//   <web-view src="https://example.com" @message="onMessage" />
//
// This file is the part both targets agree on: the three event payloads, how
// a `src` is classified and resolved, and the "one terminal event per load"
// gate. Neither side imports the other's code — the app side is Dart
// (flutter/lib/fjs_webview.dart) — so, as with scroll/metrics.ts in the
// runtime, this file is the SPEC as much as the implementation, and the Dart
// half mirrors it and points back here.
//
// Why a module and not a built-in tag: webview_flutter needs Dart SDK ^3.5,
// and flutter_fjs still declares >=3.3. Built in, every app would pay that;
// as a module, only the apps that install it do.

/** The module's short name — the npm scope is stripped by the toolchain, so
 * this is what appears in `/modules/<name>/…` and in the Flutter asset path. */
export const WEB_VIEW_MODULE = 'webview';

/** Where the web target serves the module's `public/` from. The prepare hook
 * copies the files there because vite does not serve `.fjs/`. */
export const WEB_ASSET_BASE = `/fjs-modules/${WEB_VIEW_MODULE}`;

/** Where the app's own local files land in a release build — the one
 * directory the CLI syncs public/ and html/ into (specs/017). */
export const APP_ASSET_BASE = 'assets/fjs/public';

/** Stable failure text. WKWebView and the browser word their errors
 * completely differently, and a payload that changes per platform is not a
 * contract — the platform's own message stays in the platform's log. */
export const WEB_VIEW_ERROR = 'web-view load failed';

/** `@load`: which page finished. Field order is part of the contract. */
export function loadPayload(src: string): string {
  return JSON.stringify({ src });
}

/** `@error`: which page failed, and a fixed message. */
export function errorPayload(src: string): string {
  return JSON.stringify({ src, errMsg: WEB_VIEW_ERROR });
}

/** `@message`: what the page passed to fjs.postMessage, verbatim. Objects
 * are the page's job to stringify — only strings cross this boundary. */
export function messagePayload(data: string): string {
  return JSON.stringify({ data });
}

export type SrcKind = 'empty' | 'http' | 'asset' | 'local' | 'unsupported';

/** What a `src` is, before anyone tries to load it.
 *
 * Three loadable shapes. `http(s)` is the network. `asset://` is a file THIS
 * MODULE ships — it resolves under `modules/webview/`, so an app cannot
 * name its own page that way. A root path (`/html/guide.html`) is the app's
 * own page, from the project's `html/` directory
 * (specs/018-src-hints-and-html-dir).
 *
 * Everything else stays refused: `file:`, `javascript:`, `data:` and friends
 * differ so much between WKWebView and a browser that accepting them would
 * be handing pages a portability trap. */
export function classifySrc(raw: unknown): SrcKind {
  const src = raw == null ? '' : String(raw).trim();
  if (!src) return 'empty';
  if (src.startsWith('http://') || src.startsWith('https://')) return 'http';
  if (src.startsWith('asset://')) return 'asset';
  if (src.startsWith('/')) return 'local';
  return 'unsupported';
}

export function unsupportedSrcMessage(raw: unknown): string {
  return (
    `<web-view> will not load "${String(raw)}": only http(s)://, ` +
    'a root path like "/html/page.html" (a file in the project\'s html/ ' +
    'directory) and asset:// (a file this module ships) are supported. ' +
    'Other schemes behave too differently between WKWebView and the ' +
    'browser to promise.'
  );
}

/** The path part of an `asset://` src, with the scheme and any leading
 * slashes removed. Returns null for anything that escapes the module's own
 * directory. */
export function assetPath(raw: string): string | null {
  const path = raw.slice('asset://'.length).replace(/^\/+/, '');
  if (!path || path.includes('..')) return null;
  return path;
}

/** The path part of a root-absolute src, with leading slashes removed.
 * Returns null for anything that escapes the app's own files. */
export function localPath(raw: string): string | null {
  const path = raw.replace(/^\/+/, '');
  if (!path || path.includes('..')) return null;
  return path;
}

/** Where the loaded page lives, per target.
 *
 *  * `web` — the app's own static root, put there by the prepare hook;
 *  * `app-dev` — the dev server already serves `/modules/<name>/…`;
 *  * `app-release` — a Flutter asset, which the Dart side loads with
 *    `loadFlutterAsset` rather than as a URL. It is returned as a distinct
 *    shape for exactly that reason.
 */
export type SrcTarget =
  | { target: 'web' }
  | { target: 'app-dev'; devHost: string }
  | { target: 'app-release' };

export type ResolvedSrc =
  | { kind: 'url'; url: string }
  | { kind: 'flutter-asset'; asset: string; suffix: string }
  | { kind: 'none' };

/** Everything before `?` / `#`. A Flutter asset key cannot carry either. */
export function stripQuery(path: string): string {
  const cut = path.search(/[?#]/);
  return cut < 0 ? path : path.slice(0, cut);
}

/** The part that belongs to the document URL rather than the asset key. */
export function assetSuffix(path: string): string {
  const cut = path.search(/[?#]/);
  return cut < 0 ? '' : path.slice(cut);
}

export function resolveSrc(raw: unknown, where: SrcTarget): ResolvedSrc {
  const src = raw == null ? '' : String(raw).trim();
  switch (classifySrc(src)) {
    case 'http':
      return { kind: 'url', url: src };
    case 'local': {
      // The app's own file. It rides the same root-path contract images use
      // (specs/017-local-image-assets): the browser serves it from the site
      // root, the dev server answers for it, and a release build has it as a
      // Flutter asset under assets/fjs/public/.
      const path = localPath(src);
      if (!path) return { kind: 'none' };
      if (where.target === 'web') return { kind: 'url', url: `/${path}` };
      if (where.target === 'app-dev') {
        const host = where.devHost.replace(/\/+$/, '');
        return { kind: 'url', url: `${host}/${path}` };
      }
      return {
        kind: 'flutter-asset',
        asset: `${APP_ASSET_BASE}/${stripQuery(path)}`,
        suffix: assetSuffix(path),
      };
    }
    case 'asset': {
      const path = assetPath(src);
      if (!path) return { kind: 'none' };
      if (where.target === 'web') {
        return { kind: 'url', url: `${WEB_ASSET_BASE}/${path}` };
      }
      if (where.target === 'app-dev') {
        const host = where.devHost.replace(/\/+$/, '');
        return { kind: 'url', url: `${host}/modules/${WEB_VIEW_MODULE}/${path}` };
      }
      // A Flutter asset is a KEY, not a URL: loadFlutterAsset looks the
      // string up in the bundle's manifest, so `demo.html?q=1` is simply not
      // a file and the platform throws. The key is stripped while the caller
      // keeps the suffix for the document URL. The two values must stay
      // separate: one is a bundle manifest key, the other is page state.
      return {
        kind: 'flutter-asset',
        asset: `assets/fjs/modules/${WEB_VIEW_MODULE}/${stripQuery(path)}`,
        suffix: assetSuffix(path),
      };
    }
    default:
      return { kind: 'none' };
  }
}

/** One terminal event per load, and never the previous page's.
 *
 * Same shape as the image module's cycle: a `src` change begins a new
 * generation, a result carrying an old one is dropped, and `load`/`error`
 * are mutually exclusive within a generation. */
export class LoadCycle {
  private generation = 0;
  private settled = false;

  /** Starts a new load; returns its generation. */
  begin(): number {
    this.generation += 1;
    this.settled = false;
    return this.generation;
  }

  get current(): number {
    return this.generation;
  }

  /** True when this result should be reported: it belongs to the current
   * load and nothing has settled it yet. */
  finish(generation: number): boolean {
    if (generation !== this.generation || this.settled) return false;
    this.settled = true;
    return true;
  }

  /** Whether a message from [generation] is still the current page's. A
   * message is not terminal, so it does not settle anything. */
  accepts(generation: number): boolean {
    return generation === this.generation;
  }
}
