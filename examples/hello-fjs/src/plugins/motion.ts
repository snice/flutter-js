// The polyfill must evaluate before @vueuse/motion: framesync captures its
// frame-loop source at module evaluation (see @/motion/native-polyfills.ts).
import '@/motion/native-polyfills';
import { MotionPlugin } from '@vueuse/motion';
import type { App } from 'vue';

export default (app: App) => {
  app.use(MotionPlugin);
};
