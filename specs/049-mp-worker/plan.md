# Plan: `Worker` 三端统一为 worker 文件路径，并支持小程序

对应 spec：`./spec.md`（2026-09-14 按用户新要求重写：原方案是小程序端构建期求值代码串，已作废）

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | 一个 `fjs-runtime/src/worker.ts` 同时服务 Flutter（`hasNativeHost`：fetch 脚本 → `js.worker.create`）与 Web（DOM Worker 直接用路径）；小程序 `fjs-runtime/src/wx/worker.ts` 同形 API。构建三端都产出 `/workers/*.js`。页面源码三端同一份 |
| II 边界即契约 | 否 | 三张表不动；`js.worker.create` 仍收代码串（`flutter_fjs/lib/src/worker.dart` 不改） |
| III 同步单线程零序列化 | 是（遵守） | Flutter 端取脚本复用现有 fetch 范式（异步 invokeHost + 回调），不新增阻塞调用；取到前的消息在 JS 侧排队 |
| IV 外观照 WeUI | 否 | 无 UI |
| V 静默失效是 bug | 是 | 非 `/workers/*.js` 路径抛错并给新写法；加载失败 → `onerror`（未设则 `console.error`）；worker 目录有无法打包的文件 → 构建报错带文件名；小程序第二个 Worker 自动终止时 `console.warn` |
| VI 注释记录权衡 | 是 | `worker.ts` 顶部写为什么改成路径（小程序无 eval、wx 只认文件）；Flutter 分支为什么 fetch 而不是新增 Dart 读文件（复用 dev/release 两套资源解析、不动契约）；wx shim 为什么包局部 `onmessage` |
| VII JS 能包就不要下 Dart | 是 | 取脚本放 JS（fetch），Dart 不动 |
| VIII 变更落到文档 | 是 | `docs/threading-model.md`、`docs/web.md`、`docs/performance.md`、`docs/miniprogram.md`、`docs/toolchain.md`（构建产物 `workers/`）、`docs/roadmap.md` |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI 共用 | 新增 `packages/fjs/src/project/workers.ts` | `scanWorkers(root)` → `[{ url: '/workers/a/b.js', file }]`（`src/workers/**/*.{ts,js}`，同名 ts/js 冲突报错）；`bundleWorker(root, file)` → esbuild（iife、`@/` 别名、es2020）返回代码串；`writeWorkers(root, destDir, wrap?)` 写 `destDir/workers/*.js`；`workerFileForUrl(root, url)` 给 dev 中间件用 |
| CLI / Flutter 构建 | `packages/fjs/src/bundler/build.ts` | `buildBundle` 单包与 `--pages` 两条路径结束时 `writeWorkers(root, outDir)`；`buildWeb` 写到 `webOut`；`syncPublicAssets` 把 `outDir/workers` 拷进 `assets/fjs/public/workers` |
| CLI / Flutter dev | `packages/fjs/src/dev/server.ts` | `/workers/*.js` 按需 `bundleWorker` 返回（`--web` 静态服务走 buildBundle 产物，已覆盖） |
| CLI / vite | `packages/fjs/src/vite.ts` | `configureServer` 中间件处理 `/workers/*.js`；`writeBundle` 写 `outDir/workers` |
| CLI / 小程序 | `packages/fjs/src/mp/build.ts`、`project.ts` | 写 `miniprogram/workers/*.js`（`wrapWxWorker(code)` 包 shim）；`appJson` 有 worker 时加 `"workers": "workers"` |
| JS runtime | `packages/fjs-runtime/src/worker.ts` | 构造参数改为路径并校验；Web：`new DomWorker(path)`；Flutter：`fetch(path)` → `text()` → `invokeHost('js.worker.create', code)`，之前的 `postMessage` 排队、`terminate` 取消；失败 → `onerror` |
| JS runtime（wx） | 新增 `packages/fjs-runtime/src/wx/worker.ts`；`wx/fjs-bridge.ts` | 同形 `Worker`：校验路径 → `wx.createWorker(path.slice(1))`（`workers/x.js`）；`onMessage` 解 `{d}`/`{e}`；单实例自动终止；`fjs-bridge.ts` 的抛错实现换成导出 |
| Web 适配 / Dart / C++ | — | 不改 |
| 示例 | `examples/hello-fjs/src/workers/sqrt.ts`（新）、`src/pages/api.vue`；`examples/hello-js/src/workers/fib.js`（新）、`src/gallery.ts` | 改用路径；api.vue 加 `onUnmounted` terminate |
| 测试 | `packages/fjs/test/workers.test.ts`（新）、`packages/fjs-runtime/test/worker.test.ts`（新）、`test/wx-worker.test.ts`（新） | 见 spec §6 |

## 3. 方案

### 3.1 构建：`src/workers` → `/workers/*.js`

一个共用模块负责扫描与打包，四条构建路径（Flutter 单包 / 分页、web esbuild、vite、小程序）只调用它。
esbuild `format: 'iife'`、`bundle: true`：worker 可以 import 本地模块，产物自包含；worker 源码是 ESM（严格模式），
`onmessage = …` 对未声明全局赋值——DOM Worker 与 Flutter worker prelude（`defineProperty(globalThis, 'onmessage')`）
里这是已存在的全局属性，赋值合法。

小程序 shim 把打包结果包在函数里：

```js
(function () {
  var onmessage = null;
  function postMessage(m) { worker.postMessage({ d: String(m) }); }
  function __fjsFail(err) { worker.postMessage({ e: String((err && err.message) || err) }); }
  worker.onMessage(function (msg) {
    if (typeof onmessage !== 'function') return;
    try { onmessage({ data: msg && msg.d }); } catch (err) { __fjsFail(err); }
  });
  try { /* iife bundle */ } catch (err) { __fjsFail(err); }
})();
```

iife 内部的 `onmessage = …` 解析到外层函数的局部 `var onmessage`（词法作用域），不依赖对全局赋值。

### 3.2 运行时

- Web：路径就是 URL，`new DomWorker(path)`；vite dev 由中间件按需编译，build 产物写在输出根目录。
- Flutter：`fetch(path)`——dev 连着时相对 dev server 解析、release 读 `assets/fjs/public`（`flutter_fjs/lib/src/http.dart`
  `_releaseAssetResponse`），和图片、public 文件同一条路。取到文本后 `js.worker.create`，期间 `postMessage` 排队。
- 小程序：`wx.createWorker('workers/x.js')`，单实例。

**否掉的备选**

1. *保留代码串 + 小程序构建期求值*（原 plan）：用户要求三端统一为文件路径。
2. *Flutter 新增 Dart 侧按路径读文件*（`js.worker.createFromPath`）：要动 invokeHost 名与 Dart，且 dev / release 资源解析得在 Dart 再写一遍；fetch 已有两套解析。
3. *虚拟模块把 worker 代码打进主包、按路径查表*：主包体积随 worker 增长，web 端还要转 Blob；文件形态与小程序一致更简单。
4. *vite 的 `new Worker(new URL('./x', import.meta.url))`*：小程序、Flutter 都没有 `import.meta.url` 语义。

## 4. 风险

- **R1** Flutter dev 模式 fetch 相对路径依赖 dev 连接；未连 dev 的 debug 包走 release 资源——与图片一致，不额外处理。
- **R2** wx worker 环境的 `console` / 定时器支持：DevTools 实测，缺失登记差异。
- **R3** DevTools 对 `workers` 目录 JS 再做 ES6 转换：shim 用局部变量，不受严格模式影响，实测确认。
- **R4** 本环境可能无 Flutter 设备：验收 7 若无法执行则如实说明。
- **R5** `fjs dev`（App）worker 文件修改后的刷新：按需编译每次请求都读最新源码，新建 Worker 即生效。

## 5. 验证路径

```bash
pnpm --filter @ufjs/cli test && pnpm --filter @ufjs/runtime test
pnpm --filter @ufjs/cli typecheck && pnpm --filter @ufjs/runtime typecheck
(cd examples/hello-fjs && pnpm typecheck)
pnpm --filter @ufjs/cli build
(cd examples/hello-fjs && pnpm build:mp && pnpm build:web:fjs && pnpm build)
ls examples/hello-fjs/dist/mp/miniprogram/workers examples/hello-fjs/dist/web/workers examples/hello-fjs/dist/app/workers
# web: localhost:5173/#/api 点按钮；DevTools 重开后接口 tab 点按钮两次
```
