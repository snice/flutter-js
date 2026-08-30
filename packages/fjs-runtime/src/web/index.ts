// Web adapter: the fjs tag set implemented on the DOM.
//
// `fjs build --web` aliases 'fjs/app' to app/web.ts, which calls
// installFjsWeb() on the Vue app it creates. Nothing here is pulled into a
// Flutter build.
import type { App } from 'vue';
import { fjsComponents, FJS_TAGS } from './components';
import { installBaseCss } from './base-css';
import { setToastHandler } from '../host';

/** Registers the built-in tags and the base stylesheet on [app]. */
export function installFjsWeb(app: App): void {
  installBaseCss();
  for (const [tag, component] of Object.entries(fjsComponents)) {
    app.component(tag, component as never);
  }
  setToastHandler(showToast);
}

const injected = new Set<string>();

/** Adds one SFC <style> block to the document. Called by the code the fjs
 * esbuild plugin injects; `key` dedupes across hot reloads and repeated
 * imports of the same component. */
export function injectStyle(key: string, css: string): void {
  if (injected.has(key)) return;
  injected.add(key);
  const style = document.createElement('style');
  style.setAttribute('data-fjs', key);
  style.textContent = css;
  document.head.appendChild(style);
}

/** DOM twin of the native toast overlay (`toast()` from 'fjs'). */
export function showToast(message: string): void {
  const el = document.createElement('fjs-toast');
  el.className = 'fjs-toast';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2000);
}

export { fjsComponents, FJS_TAGS };
export { BASE_CSS, installBaseCss } from './base-css';
