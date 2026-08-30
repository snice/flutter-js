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

export function createRouter(options: WebRouterOptions): FjsWebRouter {
  const matcher = new Matcher(options.routes);
  const records: RouteRecordRaw[] = options.routes.map(
    (route) =>
      ({
        path: route.path,
        name: route.name,
        meta: route.meta ?? {},
        component: route.component,
      }) as RouteRecordRaw,
  );
  const initial = options.initial ?? '/';
  if (initial !== '/' && !options.routes.some((r) => r.path === '/')) {
    records.push({ path: '/', redirect: initial } as RouteRecordRaw);
  }
  // unknown paths would otherwise warn and render nothing
  records.push({
    path: '/:pathMatch(.*)*',
    redirect: initial,
  } as RouteRecordRaw);

  const vueRouter = createVueRouter({
    history:
      options.history === 'history'
        ? createWebHistory(options.base)
        : createWebHashHistory(options.base),
    routes: records,
  });

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

export type { RouteLocation, RouteLocationRaw, Router, RouterOptions } from './types';
export type { RouteRecord, RouteMeta } from './types';
