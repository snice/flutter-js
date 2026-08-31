// @ufjs/runtime — JS runtime for the flutter_fjs native host.
//
// User-facing surface:
//   import { h, create, setProps, setText } from 'fjs';        // element API
//   import { createApp, flutterRoot } from 'fjs/vue';          // Vue 3 renderer
//   import { invokeHost } from 'fjs';                          // host modules
export { h, create, createRoot, insert, remove, setText, setProps, flush } from './ui/element';
export type { Element } from './ui/element';
export { invokeHost, nowMs, engineInfo, setTimeout, setInterval, clearTimeout, clearInterval, toast, setToastHandler, hasNativeHost, setOpSink } from './host';
export { Worker } from './worker';
export { UiOp } from './ui/ops';
