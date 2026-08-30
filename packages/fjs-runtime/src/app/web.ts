// createFjsApp for web targets. Builds a normal Vue 3 DOM app: vue-router
// for navigation (so the browser's back button and the URL work), the fjs
// tag set registered as components, and the app shell wrapping
// <router-view> exactly like it wraps a page on Flutter.
import {
  KeepAlive,
  Transition,
  createApp as createVueApp,
  h,
  type App,
  type Component,
  type VNode,
} from 'vue';
import { RouterView } from 'vue-router';
import { createRouter, type WebRouterOptions } from '../router/web';
import { installFjsWeb } from '../web/index';
import type { Router } from '../router/types';

export interface FjsAppOptions extends WebRouterOptions {
  /** Called with the Vue app before it is mounted (plugins, error handler).
   * On Flutter it runs once per page app; on web once for the whole app. */
  setup?: (app: App) => void;
  /** Web only: mount target. Default '#app'. */
  el?: string | Element;
  /** Flutter only: root element tag. Ignored here. */
  rootTag?: string;
  /** Web only: keep visited pages alive (default true), so going back
   * restores a page's scroll position and local state. Set a number to cap
   * how many pages stay cached, or false to always remount. */
  keepAlive?: boolean | number;
  /** Web only: name of the page transition, or false to turn it off.
   * Default 'fjs-page' (the stylesheet's slide-in). */
  transition?: string | false;
}

export interface FjsApp {
  readonly router: Router;
  /** Web only: the Vue app instance. */
  readonly vueApp: App;
  mount(): void;
}

export function createFjsApp(options: FjsAppOptions): FjsApp {
  const router = createRouter(options);
  const shell = options.shell as Component | undefined;

  const keepAlive = options.keepAlive ?? true;
  const transition = options.transition ?? 'fjs-page';

  const root = {
    name: 'FjsRoot',
    render: () =>
      h(RouterView, null, {
        default: ({ Component: page, route }: { Component?: VNode; route: unknown }) => {
          // h(vnode) clones it — the same thing `<component :is="Component">`
          // does in the template form of this pattern. Handing the slot's
          // vnode straight back would reuse one vnode object across renders,
          // which wedges the transition half-way through a route change.
          const child = page ? (h(page as never) as VNode) : null;
          // <KeepAlive> caches by component type, so each route keeps its
          // own instance (and its scroll offset) when you navigate away;
          // <Transition> plays the web mirror of the native push animation.
          // Both need exactly one child vnode, hence the array wrappers.
          const cached =
            child && keepAlive !== false
              ? h(
                  KeepAlive,
                  typeof keepAlive === 'number' ? { max: keepAlive } : null,
                  { default: () => [child] },
                )
              : child;
          // No `mode: 'out-in'`: with <KeepAlive> inside, the deferred
          // update it needs never arrives and the route change wedges
          // half-applied. The two pages overlap instead — hence the
          // positioned host element (see .fjs-page-leave-active).
          const body =
            transition === false
              ? cached
              : h('fjs-page-host', null, [
                  h(
                    Transition,
                    { name: transition },
                    { default: () => (cached ? [cached] : []) },
                  ),
                ]);
          return shell ? h(shell, { route }, { default: () => body }) : body;
        },
      }),
  };

  const vueApp = createVueApp(root);
  installFjsWeb(vueApp);
  vueApp.use((router as unknown as { vueRouter: never }).vueRouter);
  options.setup?.(vueApp);

  return {
    router,
    vueApp,
    mount() {
      const el = options.el ?? '#app';
      if (typeof el === 'string' && !document.querySelector(el)) {
        const host = document.createElement('div');
        host.id = el.replace(/^#/, '');
        document.body.appendChild(host);
      }
      vueApp.mount(el as never);
    },
  };
}

export { useRouter, useRoute, definePage } from '../router/web';
export type { Router, RouteLocation, RouteRecord, RouteMeta } from '../router/types';
