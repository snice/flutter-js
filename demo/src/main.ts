import { createFjsApp } from 'fjs/app';
import { routes } from 'fjs/pages';
import Shell from './Shell.vue';

createFjsApp({
  routes,
  shell: Shell,
}).mount();
