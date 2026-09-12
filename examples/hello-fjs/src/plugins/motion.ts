import { MotionPlugin } from '@vueuse/motion';
import type { App } from 'vue';

// No globals are installed for motion: its frame loop (framesync) falls back
// to the host's own 16.7ms `setTimeout` when there is no `window`, and giving
// it a fake one would flip EVERY `typeof window` probe in the VM — Anime.js
// (spec 031) reads `window` and crashes on the missing `document` at module
// evaluation, white-screening the whole page.

export default (app: App) => {
  app.use(MotionPlugin);
};
