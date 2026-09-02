// Which transition a navigation gets. Shared so both platforms answer the
// question the same way: the app-level option decides overall, a page can
// override it through `meta.transition`, and a tab switch has no animation
// (on Flutter it never had one — the base page is swapped in place).
//
// This picks the *family* (a CSS name on web). Which way it plays is not
// part of it: a pop runs the same family mirrored, driven by `data-nav` on
// the page host — see base-css.ts. That split is not cosmetic. <KeepAlive>
// hands a page it brings back the transition hooks it was cached with, so
// the name on a re-activated page can be one navigation stale; the host
// attribute is plain DOM state and is always current.
import type { Navigation, TransitionOption } from './types';

/** Web CSS name for "no animation". The <Transition> stays in the tree —
 * pulling it out around <KeepAlive> would remount the page — it just has
 * no duration to run. */
export const NO_TRANSITION = 'fjs-page-none';

/** Default transition: the stylesheet's slide-in on web, and on Flutter
 * whatever the platform does (Cupertino on iOS, the theme's builder on
 * Android) — which is why it is also the one name that does *not* look the
 * same on both. Pick one of the others when you want them to match. */
export const PAGE_TRANSITION = 'fjs-page';

/** The names both platforms know, beyond [PAGE_TRANSITION]. Each is a CSS
 * transition family in the web base stylesheet and a page route on the
 * Dart side (fjs_app.dart), so `transition: 'fjs-fade'` is the same
 * animation on web, iOS and Android. A name that is not in here is a CSS
 * name of the app's own: web runs it, Flutter falls back to the platform's
 * transition. */
export const TRANSITIONS = [
  /** iOS-style full-width slide from the right, on every platform. */
  'fjs-slide',
  /** Cross-fade, no movement. */
  'fjs-fade',
  /** Up from the bottom — a modal / sheet-like page. */
  'fjs-slide-up',
  /** Material 3's scale-and-fade. */
  'fjs-zoom',
] as const;

export type TransitionName = (typeof TRANSITIONS)[number] | typeof PAGE_TRANSITION;


export function resolveTransition(
  option: TransitionOption | undefined,
  nav: Navigation,
): string | false {
  if (typeof option === 'function') return option(nav);
  if (option === false) return false;
  // the page that moves decides: the one being pushed, and on the way back
  // the one being popped
  const moving = nav.kind === 'pop' ? nav.from : nav.to;
  const own = moving.meta?.transition;
  if (own !== undefined) return own;
  if (nav.kind === 'tab' || nav.kind === 'initial') return false;
  return option ?? PAGE_TRANSITION;
}
