# demo

Vue 3 + Vite fjs app. 首页位于 `src/pages/index.vue`，默认文本是 `hello-fjs`。

`@ufjs/iconmind`（源码在 `packages/fjs-iconmind`）是一个完整的 fjs 模块示例：
[IconMind](https://iconmind.dev) 图标包成一个 `<icon-mind />` 标签，App 上 Flutter
绘制，Web 上内联 SVG，`/icons` 页面用它。demo 对它就是一条 npm 依赖——和别人装它
的方式完全一样。

这个项目没有为它配置任何东西：模块自带构建步骤（`fjs.prepare`），每次
`fjs build` / `fjs dev` 前扫描源码里写了哪些 `<icon-mind name="…" />`，只生成那
几个图标的数据和类型（产物在 `.fjs/modules/iconmind/`，不进版本库）。名字来自
数据、扫不到的，写在根目录 `iconmind.json` 里。

`fjs modules` 可以看到模块链上了什么，细节见 [docs/modules.md](../docs/modules.md)
和模块自己的 README。

## Develop

```bash
pnpm install
pnpm run dev:web      # browser via Vite
pnpm run run:android  # Flutter Android host, created under .fjs/flutter
pnpm run run:ios      # Flutter iOS host, created under .fjs/flutter
pnpm run typecheck
```

## Build

```bash
pnpm run build
pnpm run build:bytecode
pnpm run build:pages
pnpm run build:web
pnpm run build:release  # split bytecode copied to .fjs/flutter/assets/fjs
pnpm run build:apk      # also runs flutter build apk
```

Pass Flutter build arguments after `--`:

```bash
pnpm run build:apk -- --debug
```
