// Native-host polyfill for @vueuse/motion (spec 042). Must evaluate BEFORE
// `@vueuse/motion` does — src/plugins/motion.ts imports this first, because
// ESM hoists imports and framesync (motion's frame loop) picks its scheduler
// ONCE at module evaluation:
//
//   typeof window !== 'undefined' ? window.requestAnimationFrame : setTimeout
//
// The QuickJS host has no `window`, so motion would fall into the setTimeout
// branch — a self-re-arming macrotask chain, the exact cadence problem
// Anime.js hit (spec 031, src/anime/native-polyfills.ts). A window whose rAF
// is the host's own puts every motion frame on vsync.
//
// Deliberately minimal: ONLY requestAnimationFrame. Motion's browser probes
// must keep answering false so it stays off the paths that need a real DOM
// host — `window.onpointerdown === null` (pointer/touch listeners) and
// `matchMedia in window` (reduced-motion) both read as missing on this
// object, and motion degrades to plain rAF-driven animation.
//
// On web none of this installs: `window` exists, motion takes the browser
// branches untouched (constitution I).
import { hasNativeHost } from 'fjs';

type Globals = Record<string, unknown> & { window?: unknown };

if (hasNativeHost) {
  const g = globalThis as unknown as Globals;
  if (typeof g.window === 'undefined') {
    g.window = {
      // Resolved per call: the runtime installs requestAnimationFrame while
      // it loads, and nothing here should depend on which module ran first.
      requestAnimationFrame: (cb: () => void) => requestAnimationFrame(cb),
    };
  }
}
