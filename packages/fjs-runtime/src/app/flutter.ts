// createFjsApp for Flutter targets. Each route is a native Navigator page
// with its own Vue app rooted in its own element tree, so the platform's
// back gesture and push animation apply to real Flutter routes — see
// router/flutter.ts for the wire protocol.
import type { App } from '@vue/runtime-core';
import { createRouter, type FlutterRouterOptions } from '../router/flutter';
import type { Router } from '../router/types';
import { FjsForm } from '../components/form';
import { FjsListView } from '../components/list-view';
import { FjsPicker } from '../components/picker';
import { applyPlugins, type FjsPlugin } from './plugin';

export interface FjsAppOptions extends FlutterRouterOptions {
  /** App plugins, applied in order before [setup]. Normally the generated
   * list: `import { plugins } from 'fjs/plugins'`. */
  plugins?: readonly FjsPlugin[];
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
      app.component('form', FjsForm);
      app.component('picker', FjsPicker);
      applyPlugins(app, options.plugins);
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
export type { FjsPlugin } from './plugin';
export type { Router, RouteLocation, RouteRecord, RouteMeta } from '../router/types';
