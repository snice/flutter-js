// '@ufjs/runtime/wx' — the mini-program target's runtime entry. Compiled
// SFC modules import from here (the build aliases `vue` to the same place).
// Importing this module installs the fetch polyfill as a side effect, so
// `app.js` only needs `require('fjs/shared')` and every page sees fetch.
export * from './vue';
export * from './instance';
export { registerRoutes, useRouter, useRoute, createRouter, setActiveRoute } from './router';
export type { MpRouteRecord } from './router';
export { adaptEvent } from './events';
export { stringifyClass, stringifyStyle } from './style';
export { installFetchPolyfill } from './fetch';
import { installFetchPolyfill } from './fetch';

installFetchPolyfill();
