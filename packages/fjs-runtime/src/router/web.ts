// Router for web targets: a thin facade over vue-router so app code can
// call the same `useRouter().push(...)` it calls on Flutter. The facade
// exists only to keep `currentRoute` a plain object on both platforms
// (vue-router exposes a Ref) — everything else delegates.
import {
  createRouter as createVueRouter,
  createWebHashHistory,
  createWebHistory,
  useRoute as vueUseRoute,
  type RouteRecordRaw,
  type Router as VueRouter,
} from 'vue-router';
import { Matcher } from './match';
import type { RouteLocation, RouteLocationRaw, Router, RouterOptions } from './types';

/** One KeepAlive slot per history stack entry. Path alone is not enough:
 * two visits to `/` are two pages (a push starts at 0, 0; a pop restores). */
export function historyEntryKey(
  route: { fullPath: string },
  state?: { position?: number } | null,
): string {
  const raw =
    state !== undefined
      ? state
      : typeof history !== 'undefined'
        ? (history.state as { position?: number } | null)
        : null;
  const pos = raw?.position;
  return `${typeof pos === 'number' ? pos : 0}:${route.fullPath}`;
}

export interface WebRouterOptions extends RouterOptions {
  /** 'hash' (default) works on any static host; 'history' needs a server
   * rewrite to index.html. */
  history?: 'hash' | 'history';
  /** Base path for 'history' mode. */
  base?: string;
}

export interface FjsWebRouter extends Router {
  /** The underlying vue-router, for `app.use()` and <router-view>. */
  readonly vueRouter: VueRouter;
}

let active: FjsWebRouter | null = null;

/** Translates the catch-all `*` segment the generated table uses into
 * vue-router's own syntax. `(.*)` and not `(.*)*`: the repeatable form hands
 * back an array of segments, while the Flutter matcher's `params.pathMatch`
 * is the joined string — same route, same param, one shape. */
function vueRouterPath(path: string): string {
  return path.replace(/\/\*$/, '/:pathMatch(.*)');
}

export function createRouter(options: WebRouterOptions): FjsWebRouter {
  const matcher = new Matcher(options.routes);
  const records: RouteRecordRaw[] = options.routes.map(
    (route) =>
      ({
        path: vueRouterPath(route.path),
        name: route.name,
        meta: route.meta ?? {},
        component: route.component,
      }) as RouteRecordRaw,
  );
  const initial = options.initial ?? '/';
  if (initial !== '/' && !options.routes.some((r) => r.path === '/')) {
    records.push({ path: '/', redirect: initial } as RouteRecordRaw);
  }
  // unknown paths would otherwise warn and render nothing — unless the app
  // ships its own catch-all page, which should render instead of redirecting
  if (!options.routes.some((r) => r.path === '/*')) {
    records.push({
      path: '/:pathMatch(.*)*',
      redirect: initial,
    } as RouteRecordRaw);
  }

  const vueRouter = createVueRouter({
    history:
      options.history === 'history'
        ? createWebHistory(options.base)
        : createWebHashHistory(options.base),
    routes: records,
    scrollBehavior(_to, _from, savedPosition) {
      // Window only. Page / shell scroll-views are per history entry
      // (KeepAlive), so they do not need a restore hook.
      return savedPosition ?? { left: 0, top: 0 };
    },
  });
  if (typeof history !== 'undefined' && 'scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
  }

  const router: FjsWebRouter = {
    vueRouter,
    routes: options.routes,
    get currentRoute(): RouteLocation {
      return vueRouter.currentRoute.value as unknown as RouteLocation;
    },
    push: (to) => vueRouter.push(to as never).then(() => undefined),
    replace: (to) => vueRouter.replace(to as never).then(() => undefined),
    back: () => vueRouter.back(),
    go: (delta) => vueRouter.go(delta),
    resolve: (to: RouteLocationRaw) => matcher.resolve(to),
  };
  active = router;
  return router;
}

export function useRouter(): Router {
  if (!active) throw new Error('useRouter(): no router — call createFjsApp first');
  return active;
}

/** vue-router's own useRoute: reactive, and correct inside a page that is
 * not the currently active one (kept-alive views). */
export const useRoute = vueUseRoute as unknown as () => RouteLocation;

/** No-op on web: page components are imported by the generated route
 * table instead of registering themselves from a chunk. */
export function definePage(): void {}

export type {
  RouteLocation,
  RouteLocationRaw,
  RouteName,
  RoutePath,
  Router,
  RouterOptions,
} from './types';
export type { RouteRecord, RouteMeta } from './types';
