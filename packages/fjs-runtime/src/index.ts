// @ufjs/runtime — JS runtime for the flutter_fjs native host.
//
// User-facing surface:
//   import { h, create, setProps, setText } from 'fjs';        // element API
//   import { createApp, flutterRoot } from 'fjs/vue';          // Vue 3 renderer
//   import { invokeHost } from 'fjs';                          // host modules
//   import { fetch } from 'fjs';                               // HTTP (also global)
import './raf';

export { h, create, createRoot, insert, remove, setText, setProps, setStyle, flush } from './ui/element';
export type { Element, CanvasElement } from './ui/element';
// canvas: the page-facing half. The display-list encoder and the surface
// bookkeeping stay internal — a page reaches them through getContext().
export { FjsPath2D as Path2D } from './canvas/path2d';
export { registerContextType } from './canvas/context-registry';
export { loadCanvasImage, FjsCanvasImage } from './canvas/image';
export type {
  FjsCanvasApi,
  FjsCanvasContext2D,
  FjsCanvasGradient,
  FjsCanvasImageSource,
  FjsCanvasPattern,
  FjsCanvasTextMetrics,
} from './canvas/types';
export { invokeHost, nowMs, gc, engineInfo, setTimeout, setInterval, clearTimeout, clearInterval, toast, setToastHandler, hasNativeHost, setOpSink } from './host';
export { Worker } from './worker';
export { fetch, FjsHeaders as Headers, FjsResponse as Response, FjsAbortController as AbortController } from './net/fetch';
export type { FjsRequestInit as RequestInit, FjsHeadersInit as HeadersInit, FjsAbortSignal as AbortSignal } from './net/fetch';
export { UiOp } from './ui/ops';
export type { FjsImagePath, FjsHtmlPath, FjsImageSrc, FjsHtmlSrc } from './assets';
// Framework-agnostic style engine: the Vue renderer drives this instance,
// and any other adapter (or a benchmark) constructs its own the same way —
// see docs/custom-renderer.md.
export { StyleEngine } from './css/style';
export type { CssRule, Selector } from './css/parser';
export type { FjsTouch, FjsTouchEvent, FjsTouchType, FjsEventTarget } from './ui/touch';
