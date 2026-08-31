# hello-fjs — 组件示例大全

小程序 / [hello uni-app](https://hellouniapp.dcloud.net.cn) 风格的组件画廊：
导航栏 + 分类手风琴 + 底部 tabBar，每个内置标签一个详情页。全部用 Vue 3 SFC
写成，**同一份源码跑 Flutter 和浏览器两个平台**。

```
index.html             # Vite 的 web 入口
vite.config.ts         # plugins: [fjs(), vue()]
src/
  main.ts              # createFjsApp({ routes, shell })，两平台通用
  Shell.vue            # 外壳：safe-area [导航栏 | 滚动页面 | tabBar]
  catalog.ts           # 首页目录：从生成的路由表里推导，不手写页面清单
  components/          # NavBar / TabBar / Panel（演示小节卡片）
                       #   页面里一律写 `@/components/Panel.vue`——`@/` 是
                       #   `src/`，Flutter / web / Vite 三条流水线都认
  pages/               # 文件即路由，每个文件带一个 <route> 块
    index.vue          #   /        内置组件（tab 0）
    api.vue            #   /api     toast / 定时器 / Worker / 引擎信息（tab 1）
    about.vue          #   /about   关于（tab 2）
    comp/*.vue         #   /comp/*  18 个组件详情页
```

## 跑起来

```bash
pnpm install
```

```bash
pnpm build             # Flutter：单包 dist/bundle.js
pnpm build:pages       # Flutter：分包 shared.js + bundle.js + pages/*.js
pnpm build:web         # 浏览器：vite build → dist/web（静态站点）
pnpm typecheck         # vue-tsc --noEmit
```

```bash
pnpm dev               # fjs dev（单包），配合 examples/fjs-go 连上
pnpm dev:pages         # fjs dev --pages（分包，验证 prelude + 按需 chunk）
pnpm dev:web           # vite，http://localhost:5173
```

跑到真机 / 模拟器上（首次会在 `.fjs/flutter/` 里生成 Flutter 宿主工程）：

```bash
pnpm run:android
pnpm run:ios
pnpm build:release     # 分包字节码拷进 .fjs/flutter/assets/fjs
pnpm build:apk         # 再跑一次 flutter build apk
```

web 这一端有两条路，两条都从 `src/pages` 走同一张路由表、同一套平台门控：

- `pnpm dev:web` / `pnpm build:web` —— **标准 Vite**（`@vitejs/plugin-vue` +
  `@ufjs/cli/vite` 的 `fjs()` 插件）。HMR、`vite build` 的按页 chunk，跟普通
  Vue 3 + Vite 工程完全一样，`fjs create` 的模板给的也是这套。
- `pnpm dev:web:fjs` / `pnpm build:web:fjs` —— CLI 自带的 esbuild web 构建
  （`fjs build --web`），不需要 Vite。输出同样落在 `dist/web`。

不用 Flutter 也能看一眼帧输出：

```bash
../../packages/flutter_fjs/native/build-native/fjsrun dist/bundle.js
```

## 这个示例在验证什么

- **路由**：`router.push('/comp/button')` 在 Flutter 上是一个**原生 Navigator
  页面**（平台转场 + 手势返回），在 web 上是 vue-router。页面代码只写一次。
- **tabBar**：`router.replace('/api')`——栈里只有首页时原地换页，不进栈。
- **自动路由表**：`src/pages` 扫出来的，`catalog.ts` 直接读 `routes` 生成首页
  目录，所以不会出现「目录里有、页面没有」。
- **平台门控**：`pages/comp/refresh.vue` 的 `<route>` 里写了
  `"platforms": ["app"]`——下拉刷新是原生手势，web 构建里这一页整个不存在，
  首页手风琴也自动少一条。
- **分包**：`pnpm build:pages` 后 `dist/bundle.js` 只有 ~2.4 KB，vue + 运行时 +
  外壳都在 `shared.js` 里，每个页面 6–12 KB 按需加载。

细节见 [docs/routing.md](../../docs/routing.md)、[docs/web.md](../../docs/web.md)、
[docs/ui-api.md](../../docs/ui-api.md)。
