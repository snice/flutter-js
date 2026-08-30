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
  style.textContent = expandDirection(expandFlexGrow(css));
  document.head.appendChild(style);
}

// Two fjs style keys that a browser would not understand on its own. The
// boundary these match is "not part of a longer property name" rather than
// the start of a declaration: compileStyle leaves comments in, so a
// declaration does not always follow a `;` or a `{`.

// `flex-grow: n` becomes an Expanded on Flutter: the child gets its share of
// what is left over, not its natural size plus a share. CSS keeps the
// natural size in flex-basis, so a tall scrolling page would push the rest
// of the column (a bottom tabBar, say) off-screen or squash it. Rewriting to
// the `n 1 0` shorthand is the same declaration Flutter reads.
const FLEX_GROW_DECL =
  /(^|[^-\w])flex-grow\s*:\s*([0-9.]+)\s*(!important)?(?=\s*[;}]|\s*$)/g;

// `direction: horizontal` is scroll-view's own style key — it picks the axis
// of the Flutter scrollable. The CSS property of that name means something
// else (ltr / rtl), so a browser drops the declaration as invalid and the
// scroll-view never scrolls sideways. Rewrite it to the overflow pair it
// stands for; a real `direction: ltr | rtl` passes through untouched.
const DIRECTION_DECL =
  /(^|[^-\w])direction\s*:\s*(horizontal|vertical)\s*(!important)?(?=\s*[;}]|\s*$)/g;

function expandFlexGrow(css: string): string {
  return css.replace(
    FLEX_GROW_DECL,
    (_m, before: string, grow: string, bang = '') =>
      `${before}flex: ${grow} 1 0%${bang ? ' ' + bang : ''}`,
  );
}

function expandDirection(css: string): string {
  return css.replace(
    DIRECTION_DECL,
    (_m, before: string, axis: string, bang = '') => {
      const b = bang ? ' ' + bang : '';
      return axis === 'horizontal'
        ? `${before}overflow-x: auto${b}; overflow-y: hidden${b}`
        : `${before}overflow-x: hidden${b}; overflow-y: auto${b}`;
    },
  );
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
