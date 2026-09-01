import { createFjsApp } from 'fjs/app';
import { routes } from 'fjs/pages';
import Shell from './Shell.vue';
import { plugins } from 'fjs/plugins';

createFjsApp({
  plugins,
  routes,
  shell: Shell,
}).mount();
