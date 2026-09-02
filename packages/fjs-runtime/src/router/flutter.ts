// Router for Flutter targets: every page is a real Flutter Navigator route,
// so the platform's back gesture and page transition come for free. This
// module only owns the JS half — creating a root element per page, mounting
// the page component into it and tearing it down when the native navigator
// says the route is gone.
//
// Wire protocol (all through the existing host/event channels):
//   JS -> Dart   invokeHost('fjs.nav.push'    , key, fullPath, title, chunk, anim)
//                invokeHost('fjs.nav.replace' , key, fullPath, title, chunk, anim)
//                invokeHost('fjs.nav.pop')
//   Dart -> JS   dispatchEvent(key, 10 /* navMount */)  chunk is in the VM,
//                                                       mount the page now
//                dispatchEvent(key, 11 /* navPop */)    route is gone
//
// The page component itself lives in a separate chunk (`fjs build --pages`);
// Dart loads it before sending navMount, which is why mounting is always
// driven by the callback instead of happening inline in push().
//
// Tab pages (`meta.tab` is a number) are the one thing that is not torn
// down: switching between two of them parks the leaving page — its app
// stays mounted and its root only goes offstage (`__navHidden`) — so the
// tab is found exactly as it was left, the way a mini program's tabBar
// behaves. Leaving the tab group for any other page drops the parked
// pages with it.
import {
  getCurrentInstance,
  h,
  inject,
  reactive,
  type App,
  type Component,
} from '@vue/runtime-core';
// createApp here is the fjs custom renderer's, not runtime-dom's
import { createApp as createVueApp, flutterRoot } from '../vue/renderer';
import { remove, setProps, registerSystemHandler, type Element } from '../ui/element';
import { hasNativeHost, invokeHost } from '../host';
import { Matcher } from './match';
import { PAGE_TRANSITION, resolveTransition } from './transition';
import type {
  NavKind,
  RouteLocation,
  RouteLocationRaw,
  Router,
  RouterOptions,
  TransitionOption,
} from './types';

const EVENT_NAV_MOUNT = 10;
const EVENT_NAV_POP = 11;
// dev only: `fjs dev` re-evaluated one page chunk, payload is its name
const EVENT_DEV_PAGE_RELOAD = 13;

export const ROUTER_KEY = Symbol.for('fjs.router');
export const ROUTE_KEY = Symbol.for('fjs.route');

// ---- page registry ---------------------------------------------------------

interface PageRegistry {
  [path: string]: Component;
}

/** Page chunks register themselves here as they are evaluated into the VM. */
function registry(): PageRegistry {
  const g = globalThis as unknown as { __FJS_PAGES?: PageRegistry };
  return (g.__FJS_PAGES ??= {});
}

/** Called by the page-chunk entry the CLI generates. */
export function definePage(path: string, component: Component): void {
  registry()[path] = component;
}

export function pageComponent(path: string): Component | undefined {
  return registry()[path];
}

// ---- router ----------------------------------------------------------------

interface PageEntry {
  key: number;
  location: RouteLocation;
  route: RouteLocation; // reactive copy handed to the page
  root: Element | null;
  app: App | null;
}

export interface FlutterRouterOptions extends RouterOptions {
  /** Tag of each page's root element. `stack` hands a bounded height down,
   * which is what a shell with a fixed header/footer needs. */
  rootTag?: string;
  /** Hook to configure every page's Vue app (plugins, error handler). */
  onCreateApp?: (app: App) => void;
  /** Page transition. The names in `TRANSITIONS` ('fjs-fade',
   * 'fjs-slide', 'fjs-slide-up', 'fjs-zoom') are native page routes here
   * and the matching CSS families on web, so the same name animates the
   * same way on both. The default, 'fjs-page', is the *platform's* own
   * transition (Cupertino on iOS, the theme's builder on Android) — pick
   * one of the named ones when iOS and Android should match. Any other
   * string is a web CSS name and falls back to the platform transition
   * here. `false` (or `meta.transition: false`) pushes the route with no
   * animation at all. */
  transition?: TransitionOption;
}

class FlutterRouter implements Router {
  readonly routes;
  readonly currentRoute: RouteLocation;

  private matcher: Matcher;
  private stack: PageEntry[] = [];
  private nextKey = 1;
  private pending = new Map<number, { entry: PageEntry; replaceKey?: number }>();
  /** Tab pages kept alive across a tab switch, by path. */
  private parked = new Map<string, PageEntry>();

  constructor(private options: FlutterRouterOptions) {
    this.routes = options.routes;
    this.matcher = new Matcher(options.routes);
    this.currentRoute = reactive(blankLocation()) as RouteLocation;
    registerSystemHandler(EVENT_NAV_MOUNT, (key) => this.onNavMount(key));
    registerSystemHandler(EVENT_NAV_POP, (key) => this.onNavPop(key));
    registerSystemHandler(EVENT_DEV_PAGE_RELOAD, (_key, chunk) =>
      this.onDevPageReload(chunk ?? ''),
    );
  }

  resolve(to: RouteLocationRaw): RouteLocation {
    return this.matcher.resolve(to);
  }

  /** Mounts the initial page into the base root. Called by createFjsApp.
   * Goes through replace() so the initial page is chunk-loaded like any
   * other one. */
  /** Mounts the initial page into the base root. Called by createFjsApp.
   * Goes through replace() so the initial page is chunk-loaded like any
   * other one. */
  start(): void {
    void this.replace(this.options.initial ?? '/');
  }

  async push(to: RouteLocationRaw): Promise<void> {
    const location = this.resolve(to);
    if (!hasNativeHost) {
      // headless (fjsrun / tests): no navigator, so swap in place
      return this.replace(to);
    }
    const key = this.nextKey++;
    const entry = this.newEntry(key, location);
    this.pending.set(key, { entry });
    invokeHost(
      'fjs.nav.push',
      key,
      location.fullPath,
      String(location.meta.title ?? ''),
      this.chunkOf(location),
      this.animationOf(location, 'push'),
    );
  }

  async replace(to: RouteLocationRaw): Promise<void> {
    const location = this.resolve(to);
    const current = this.stack[this.stack.length - 1];
    if (!current || current.key === 0 || !hasNativeHost) {
      // replacing the base page: no navigator involved, remount in place —
      // except between two tab pages, where the leaving one is parked and
      // the arriving one, if it was parked before, comes back as it was
      if (current && isTabRoute(current.location) && isTabRoute(location)) {
        this.park(current);
      } else {
        this.teardown(current);
        this.dropParked();
      }
      const parked = isTabRoute(location) ? this.parked.get(location.path) : undefined;
      if (parked) {
        this.parked.delete(location.path);
        if (parked.location.fullPath === location.fullPath) {
          this.stack = [parked];
          this.unpark(parked);
          Object.assign(this.currentRoute, parked.location);
          return;
        }
        // same tab, different query: the parked copy is stale
        this.teardown(parked);
      }
      const entry = this.newEntry(0, location);
      this.stack = [entry];
      const chunk = this.chunkOf(location);
      if (chunk && !pageComponent(location.path) && hasNativeHost) {
        // the base page lives in a chunk that is not in the VM yet
        this.pending.set(0, { entry });
        invokeHost('fjs.nav.load', 0, location.fullPath, chunk);
        return;
      }
      this.mount(entry);
      return;
    }
    const key = this.nextKey++;
    const entry = this.newEntry(key, location);
    this.pending.set(key, { entry, replaceKey: current.key });
    invokeHost(
      'fjs.nav.replace',
      key,
      location.fullPath,
      String(location.meta.title ?? ''),
      this.chunkOf(location),
      this.animationOf(location, 'replace'),
    );
  }

  back(): void {
    if (this.stack.length <= 1) return;
    if (!hasNativeHost) {
      this.onNavPop(this.stack[this.stack.length - 1].key);
      return;
    }
    invokeHost('fjs.nav.pop');
  }

  go(delta: number): void {
    if (delta >= 0) {
      console.warn('[fjs-router] forward navigation is not available on Flutter');
      return;
    }
    for (let i = 0; i < -delta; i++) this.back();
  }

  // ---- internals -----------------------------------------------------------

  private chunkOf(location: RouteLocation): string {
    const record = this.matcher.record(location.path);
    return record?.chunk ?? '';
  }

  /** The transition name for the host: '' = the platform's own, 'none' =
   * no animation, otherwise one of TRANSITIONS (an unknown name reaches
   * Dart too and falls back there). A pop is the mirror of the push that
   * put the route there, so the native side needs no second answer for the
   * way back. */
  private animationOf(location: RouteLocation, kind: NavKind): string {
    const from = this.stack[this.stack.length - 1]?.location ?? blankLocation();
    const resolved = resolveTransition(this.options.transition, {
      to: location,
      from,
      kind,
    });
    if (resolved === false) return 'none';
    return resolved === PAGE_TRANSITION ? '' : resolved;
  }

  private newEntry(key: number, location: RouteLocation): PageEntry {
    return {
      key,
      location,
      route: reactive({ ...location }) as RouteLocation,
      root: null,
      app: null,
    };
  }

  /** Dart finished loading the page chunk for `key`. */
  private onNavMount(key: number): void {
    const pending = this.pending.get(key);
    if (!pending) return;
    this.pending.delete(key);
    const { entry, replaceKey } = pending;
    if (replaceKey !== undefined) {
      const index = this.stack.findIndex((e) => e.key === replaceKey);
      if (index >= 0) {
        this.teardown(this.stack[index]);
        this.stack.splice(index, 1);
      }
    }
    this.stack.push(entry);
    this.mount(entry);
  }

  /** The native navigator dropped the route (back gesture, pop, or the
   * replace we asked for). */
  private onNavPop(key: number): void {
    this.pending.delete(key);
    const index = this.stack.findIndex((e) => e.key === key);
    if (index < 0) return;
    this.teardown(this.stack[index]);
    this.stack.splice(index, 1);
    const top = this.stack[this.stack.length - 1];
    if (top) Object.assign(this.currentRoute, top.location);
  }

  /** `fjs dev` rebuilt one page chunk and the host has already evaluated
   * the new copy: remount the pages that came from it so the edit shows,
   * and leave the rest of the app — other pages on the stack, their state,
   * the VM itself — alone. A chunk whose page is not on the stack needs
   * nothing: the registry already holds the new component for the next
   * time that page is opened. */
  private onDevPageReload(chunk: string): void {
    if (!chunk) return;
    // a parked page is off screen: dropping it is enough — the next switch
    // to that tab builds it from the new chunk
    for (const [path, entry] of [...this.parked]) {
      if (this.chunkOf(entry.location) !== chunk) continue;
      this.parked.delete(path);
      this.teardown(entry);
    }
    for (const entry of [...this.stack]) {
      if (this.chunkOf(entry.location) !== chunk) continue;
      this.teardown(entry);
      this.mount(entry);
    }
  }

  /** Takes a tab page off screen without unmounting it. The root element
   * stays in the tree so Flutter keeps the page's widget state (scroll
   * offsets, focus, animations) — see FjsView, which renders a hidden root
   * offstage. */
  private park(entry: PageEntry): void {
    const previous = this.parked.get(entry.location.path);
    if (previous && previous !== entry) this.teardown(previous);
    this.parked.set(entry.location.path, entry);
    if (entry.root) setProps(entry.root, { __navHidden: true });
  }

  private unpark(entry: PageEntry): void {
    if (entry.root) setProps(entry.root, { __navHidden: false });
  }

  private dropParked(): void {
    for (const entry of this.parked.values()) this.teardown(entry);
    this.parked.clear();
  }

  private mount(entry: PageEntry): void {
    const page = pageComponent(entry.location.path);
    if (!page) {
      console.warn(`[fjs-router] no page registered for ${entry.location.path}`);
    }
    const root = flutterRoot(this.options.rootTag ?? 'stack');
    // the marker the Dart navigator matches its route against
    setProps(root, { __navKey: entry.key });
    entry.root = root;

    const shell = this.options.shell;
    const content = () => (page ? h(page) : h('view'));
    const app = createVueApp({
      name: 'FjsPage',
      render: () =>
        shell
          ? h(shell as Component, { route: entry.route }, { default: content })
          : content(),
    });
    app.provide(ROUTER_KEY, this);
    app.provide(ROUTE_KEY, entry.route);
    this.options.onCreateApp?.(app);
    entry.app = app;
    app.mount(root);
    Object.assign(this.currentRoute, entry.location);
  }

  private teardown(entry: PageEntry | undefined): void {
    if (!entry) return;
    entry.app?.unmount();
    entry.app = null;
    if (entry.root) remove(entry.root);
    entry.root = null;
  }
}

/** A tab page: reachable from the tab bar, kept alive across a switch. */
function isTabRoute(location: RouteLocation): boolean {
  return typeof location.meta.tab === 'number';
}

function blankLocation(): RouteLocation {
  return { path: '/', fullPath: '/', params: {}, query: {}, meta: {} };
}

let active: FlutterRouter | null = null;

export function createRouter(options: FlutterRouterOptions): Router & { start(): void } {
  const router = new FlutterRouter(options);
  active = router;
  return router;
}

/** inject() only works inside setup(); module-level helpers get the
 * process-wide router/route instead of an undefined. */
function injectOr<T>(key: symbol, fallback: T): T {
  if (!getCurrentInstance()) return fallback;
  return inject<T>(key as never, fallback);
}

/** The router instance. Works outside setup() too (module-level helpers). */
export function useRouter(): Router {
  if (!active) throw new Error('useRouter(): no router — call createFjsApp first');
  return injectOr<Router>(ROUTER_KEY, active as Router);
}

/** The route of the page the calling component belongs to. */
export function useRoute(): RouteLocation {
  const fallback = active?.currentRoute ?? blankLocation();
  return injectOr<RouteLocation>(ROUTE_KEY, fallback);
}

export type {
  RouteLocation,
  RouteLocationRaw,
  RouteName,
  RoutePath,
  Router,
  RouterOptions,
} from './types';
export type { RouteRecord, RouteMeta } from './types';
