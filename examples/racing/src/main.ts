// racing — flutter3d_demo_racing 的 three.js 复刻。
//
// 同一份代码跑两个平台：
//   pnpm build / pnpm dev        → Flutter
//   pnpm build:web / pnpm dev:web → 浏览器
import { createFjsApp } from 'fjs/app';
import { routes } from 'fjs/pages';
import Shell from './Shell.vue';

createFjsApp({
  routes,
  shell: Shell,
  setup(app) {
    app.config.errorHandler = (err: unknown, _i: unknown, info: string) => {
      console.log('[vue-error]', info, String(err));
      const stack = (err as Error)?.stack;
      if (stack) console.log('[vue-stack]', stack);
    };
  },
}).mount();
