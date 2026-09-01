// The app-plugin contract shared by both targets.
//
// A plugin is just a function that gets the Vue app before it mounts, which
// is exactly what `app.use()` wants — so `src/plugins/pinia.ts` can be
//
//   const pinia = createPinia();
//   export default (app: App) => app.use(pinia);
//
// `fjs build` collects `src/plugins/*.ts` into the generated module
// 'fjs/plugins' (the same trick 'fjs/pages' uses for the route table), and
// the app entry passes them here.
//
// Ordering note for Flutter: every page is its own Vue app, so each plugin
// runs once per page. Anything that must be shared across pages — a Pinia
// instance, an i18n instance — belongs at module scope in the plugin file,
// not inside the exported function.
import type { App } from '@vue/runtime-core';

export type FjsPlugin = (app: App) => void;

export function applyPlugins(app: App, plugins?: readonly FjsPlugin[]): void {
  if (!plugins) return;
  for (const plugin of plugins) plugin(app);
}
