// createFjsApp for Flutter targets. Each route is a native Navigator page
// with its own Vue app rooted in its own element tree, so the platform's
// back gesture and push animation apply to real Flutter routes — see
// router/flutter.ts for the wire protocol.
import type { App } from '@vue/runtime-core';
import { createRouter, type FlutterRouterOptions } from '../router/flutter';
import type { Router } from '../router/types';
import { FjsListView } from '../components/list-view';

export interface FjsAppOptions extends FlutterRouterOptions {
  /** Called with the Vue app before it is mounted. On Flutter this runs
   * once per page (each page is its own app). */
  setup?: (app: App) => void;
  /** Web only: mount target. Ignored here. */
  el?: string | unknown;
}

export interface FjsApp {
  readonly router: Router;
  mount(): void;
}

export function createFjsApp(options: FjsAppOptions): FjsApp {
  const router = createRouter({
    ...options,
    onCreateApp(app) {
      app.component('list-view', FjsListView);
      options.setup?.(app);
    },
  });
  return {
    router,
    mount() {
      router.start();
    },
  };
}

export { useRouter, useRoute, definePage } from '../router/flutter';
export type { Router, RouteLocation, RouteRecord, RouteMeta } from '../router/types';
