# Tasks: `Worker` 三端统一为 worker 文件路径，并支持小程序

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 确认三张跨端契约表与 `js.worker.*` invokeHost 语义不变；公开 API 约定：`new Worker('/workers/<rel>.js')`，
  `src/workers/<rel>.{ts,js}` ↔ URL，消息仍为字符串

## 实现

- [x] T010 worker 扫描与打包共用模块（新增 `packages/fjs/src/project/workers.ts`）
- [x] T011 Flutter 构建写 `workers/` 并同步进 release 资源（`packages/fjs/src/bundler/build.ts` `buildBundle` / `buildPages` / `syncPublicAssets`）
- [x] T012 Web esbuild 构建写 `workers/`（`packages/fjs/src/bundler/build.ts` `buildWeb`）
- [x] T013 dev 服务 `/workers/*.js` 按需编译（`packages/fjs/src/dev/server.ts`）
- [x] T014 vite 插件：dev 中间件 + `writeBundle`（`packages/fjs/src/vite.ts`）
- [x] T015 运行时 `Worker` 改为路径：校验、Web DOM Worker、Flutter fetch → create + 排队（`packages/fjs-runtime/src/worker.ts`）
- [x] T016 小程序构建：wx shim 包装写 `miniprogram/workers/`、`app.json` `workers`（`packages/fjs/src/mp/build.ts`、`project.ts`）
- [x] T017 wx 运行时 `Worker`（新增 `packages/fjs-runtime/src/wx/worker.ts`，`wx/fjs-bridge.ts`）
- [x] T018 示例迁移：`examples/hello-fjs/src/workers/sqrt.ts` + `api.vue`（含 onUnmounted terminate）；`examples/hello-js/src/workers/fib.js` + `gallery.ts`

## 两端对齐

- [x] T020 Flutter / Web 同一份 `worker.ts` 两个分支，页面源码三端相同（T015 已含）
- [x] T021 对拍：web（vite dev）与微信 DevTools 接口页结果数值一致；Flutter 若有设备则 `fjs dev` 验证

## 测试

- [x] T030 CLI：扫描 / URL 映射 / 打包内联本地模块 / wx shim / appJson（新增 `packages/fjs/test/workers.test.ts`）
- [x] T031 runtime：路径校验、Web 分支、Flutter 分支排队与 onerror（新增 `packages/fjs-runtime/test/worker.test.ts`）
- [x] T032 wx runtime：createWorker、消息往返、单实例自动终止（新增 `packages/fjs-runtime/test/wx-worker.test.ts`）

## 文档

- [x] T040 更新 `docs/threading-model.md`、`docs/web.md`、`docs/performance.md`、`docs/miniprogram.md`、`docs/toolchain.md`
- [x] T041 `docs/roadmap.md` 登记

## 验收

- [x] T050 typecheck（cli / runtime / hello-fjs）
- [x] T051 `pnpm --filter @ufjs/cli test`、`pnpm --filter @ufjs/runtime test`
- [x] T052 spec.md 第 6 节逐条核对
