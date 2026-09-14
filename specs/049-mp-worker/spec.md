# Spec: `Worker` 三端统一为 worker 文件路径，并支持小程序（wx.createWorker）

- **ID**: 049-mp-worker
- **状态**: done
- **日期**: 2026-09-14

## 1. 要解决什么

fjs 的 `Worker`（`packages/fjs-runtime/src/worker.ts`）现在收**代码字符串**：Flutter 端经
`invokeHost('js.worker.create', code)` 起 Dart isolate + 独立 QuickJS，Web 端转 Blob URL 起 DOM Worker。
示例 `examples/hello-fjs/src/pages/api.vue`、`examples/hello-js/src/gallery.ts` 都把 worker 代码拼成字符串传入。

小程序端 `Worker()` 直接抛错（`packages/fjs-runtime/src/wx/fjs-bridge.ts`），接口页点「后台线程计算」就报错。
小程序有 `wx.createWorker`，但只认 `app.json` `"workers"` 目录里的**真实 JS 文件**（绝对路径），且不能 `eval`
——代码字符串 API 在小程序上无法实现。

用户决定（2026-09-14）：三端一起约束成**传 worker 文件路径**，代码字符串写法移除。

## 2. 不做什么（Non-goals）

- **不**保留 `new Worker(代码字符串)`，也不做兼容期告警（用户选择直接移除）。
- **不**做 Worker 分包（`isSubpackage`）、`useExperimentalWorker`、`onProcessKilled`。
- **不**改消息契约：仍然只有字符串（`postMessage(string)`、`onmessage({ data: string })`）。
- **不**改 Dart / C++ 侧 Worker 实现与 invokeHost 名（`js.worker.create/post/terminate` 仍收代码串，由 JS 取到后交过去）。
- worker 文件里**不能**用 `fjs` / `vue` 运行时（worker 没有 UI 与宿主桥）；可 import 项目本地纯逻辑模块。

## 3. 用户可见的行为

worker 放在约定目录 `src/workers/`（TS 或 JS，可 import 本地模块，构建期打成自包含脚本）：

```ts
// src/workers/sqrt.ts
declare function postMessage(message: string): void; // DOM lib 的 postMessage 要两个参数

onmessage = (e) => {
  const n = Number(e.data);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.sqrt(i);
  postMessage(String(Math.round(sum)));
};
```

```ts
import { Worker } from 'fjs';
const w = new Worker('/workers/sqrt.js');   // src/workers/sqrt.ts → /workers/sqrt.js
w.onmessage = (e) => { result.value = e.data; };
w.onerror = (msg) => console.error(msg);    // 加载失败 / worker 内出错（能拿到时）
w.postMessage('3000000');
w.terminate();
```

- 路径规则：`src/workers/<rel>.{ts,js}` ↔ `'/workers/<rel>.js'`（同 `wx.createWorker` 的绝对路径形状）。
- 传入的不是 `/workers/….js` 形状（例如旧的代码字符串）→ 抛错，信息说明新写法。
- 路径形状对但文件不存在 → Web / Flutter 加载失败时回调 `onerror`；小程序 `wx.createWorker` 的错误原样抛出。
- worker 内全局：`onmessage`（可赋值）、`postMessage(string)`、`console`、定时器（小程序端视 wx worker 环境，验收核对）。
- 小程序同时只能有 1 个 Worker：已有一个活着时再建，自动终止旧的并 `console.warn` 一次（Q1）。
- hello-fjs `api.vue` 在 `onUnmounted` 里终止 Worker（Q2）。

## 4. 端间约定（宪法 I）

| | Flutter | Web | 小程序 |
|---|---|---|---|
| 构建产物 | `src/workers/*` 打成 `<outDir>/workers/*.js`；release 同步到 `assets/fjs/public/workers/` | `<web 输出>/workers/*.js`；vite dev 中间件按需编译 | `miniprogram/workers/*.js`（外包 wx shim），`app.json` `"workers": "workers"` |
| dev 取文件 | `fjs dev` 服务 `/workers/*.js`（按需编译） | vite / `fjs dev --web` 同 | `fjs dev --mp` 全量重建 |
| 创建 | `fetch(path)` 取脚本文本 → `js.worker.create`；取到前的 `postMessage` 排队 | `new DOM Worker(path)` | `wx.createWorker(path)` |
| 消息 | 字符串 | 字符串 | 字符串（wx 侧包成 `{ d }` 往返） |
| 并发 | 不限 | 不限 | 1，建新自动终止旧的 |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及（`js.worker.*` 语义不变；公开 JS API `Worker` 的参数含义变了，见 docs）

## 6. 验收标准

1. `pnpm --filter @ufjs/cli test`：新增用例覆盖 worker 扫描（`src/workers` → URL）、打包自包含（本地模块被内联）、
   小程序 shim 包装与 `app.json` `workers` 字段。
2. `pnpm --filter @ufjs/runtime test`：新增用例覆盖 `Worker` 路径校验（代码串抛错）、Web 分支用路径起 DOM Worker、
   Flutter 分支 fetch 后 create 且排队消息在创建后送出、加载失败走 onerror；wx 分支 createWorker 路径、消息往返、第二个自动终止 + 告警。
3. typecheck：`@ufjs/cli`、`@ufjs/runtime`、hello-fjs `pnpm typecheck`。
4. hello-fjs：`build:mp` 后 `dist/mp/miniprogram/workers/sqrt.js` 存在、`app.json` 含 `"workers"`；
   `build:web:fjs` 后 `dist/web/workers/sqrt.js` 存在；`build`（app）后 `dist/app/workers/sqrt.js` 存在。
5. Web（`localhost:5173/#/api`，vite dev）点「后台线程计算 300 万次开方」出结果。
6. 微信开发者工具（skyline）接口 tab 点同一按钮：结果数值与 web 相同；连续点两次都出结果；控制台无报错。
7. Flutter：`fjs dev` 连 App 后接口页点同一按钮出结果（本环境无设备则如实说明，列为待用户验收）。
8. 文档：`docs/threading-model.md`、`docs/web.md`、`docs/performance.md`、`docs/miniprogram.md`、`docs/toolchain.md` 改为新写法。

## 7. 待澄清

> 2026-09-14 用户答复：Q1 自动终止旧的；Q2 示例页加 onUnmounted terminate；Q3 三端统一传文件路径、约定目录 `src/workers/`；
> Q4 代码串写法直接移除；Q5 worker 文件 TS/JS 可 import 本地模块。

- [x] Q1 小程序超过 1 个 Worker：自动终止旧的 + 告警
- [x] Q2 api.vue 补 onUnmounted terminate
- [x] Q3 路径形态：`src/workers/<rel>.ts|js` ↔ `/workers/<rel>.js`
- [x] Q4 旧写法：移除
- [x] Q5 worker 文件：TS/JS，esbuild 打成自包含脚本
