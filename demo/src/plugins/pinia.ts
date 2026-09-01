import { createPinia } from 'pinia';
import type { App } from 'vue';

// Module scope on purpose. On Flutter every page is its own Vue app, so
// this function runs once per page — creating the Pinia instance inside it
// would give each page a private set of stores that never share state.
const pinia = createPinia();

export default (app: App) => {
  app.use(pinia);
};
