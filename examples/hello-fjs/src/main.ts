// hello-fjs — 组件示例大全（小程序 / hello uni-app 风格）。
//
// 同一份代码跑两个平台：
//   pnpm build / pnpm dev        → Flutter（每个路由是一个原生 Navigator 页面）
//   pnpm build:web / pnpm dev:web → 浏览器（vue-router + DOM 标签适配）
// 路由表由 src/pages 自动生成，见 fjs/pages。
import { createFjsApp } from 'fjs/app';
import { routes } from 'fjs/pages';
import Shell from './Shell.vue';

createFjsApp({
  routes,
  transition: 'fjs-slide',
  shell: Shell,
  setup(app) {
    app.config.errorHandler = (err: unknown, _i: unknown, info: string) => {
      console.log('[vue-error]', info, String(err));
      const stack = (err as Error)?.stack;
      if (stack) console.log('[vue-stack]', stack);
    };
  },
}).mount();
