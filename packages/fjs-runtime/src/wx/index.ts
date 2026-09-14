// '@ufjs/runtime/wx' — the mini-program target's runtime entry. Compiled
// SFC modules import from here (the build aliases `vue` to the same place).
// Importing this module installs the fetch polyfill as a side effect, so
// `app.js` only needs `require('fjs/shared')` and every page sees fetch.
export * from './vue';
export * from './instance';
export { registerRoutes, useRouter, useRoute, createRouter, setActiveRoute, onPageSettled } from './router';
export type { MpRouteRecord } from './router';
export { adaptEvent } from './events';
export { stringifyClass, stringifyStyle, resolveCssColor, onCssVarsChange } from './style';
export { installFetchPolyfill } from './fetch';
export { buildWxRichText } from './rich-text';
import { buildWxRichText } from './rich-text';
import { installFetchPolyfill } from './fetch';
import { installAnimationFramePolyfill } from './raf';
export { requestAnimationFrame, cancelAnimationFrame } from './raf';

installFetchPolyfill();
installAnimationFramePolyfill();

// fjs-rich-text is a plain Component() file copied into the project; it
// cannot import this TypeScript runtime by a stable path, so the pipeline is
// published on the same global as resolveCssColor (style.ts).
(globalThis as Record<string, unknown>).__fjsWx = {
  ...((globalThis as Record<string, unknown>).__fjsWx as object | undefined),
  buildWxRichText,
};
