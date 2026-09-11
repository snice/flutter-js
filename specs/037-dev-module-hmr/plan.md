# Plan: dev 模式模块级 HMR

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是（dev 协议） | 同一套 WS 文本协议推给两端；web 端（`RELOAD_SNIPPET`）执行上退化为 `location.reload()`，差异登记进 `docs/web.md`。页面热替换的 JS 逻辑全在 fjs-runtime（router 的 `onDevPageReload`，既有代码），两端共用。 |
| II 边界即契约 | 否（三张表不动） | 不新增 op / natives / 事件号：热替换复用 `fjs_vm_eval_source` 与 runtime 内部事件 13（`FJS_EVENT_DEV_PAGE_RELOAD`）。第四张契约——dev WS 文本协议（`dev/server.ts` ↔ `dev_client.dart` ↔ `RELOAD_SNIPPET`）三处同步。 |
| III 同步单线程零序列化 | 是 | 热替换 = 在同一 VM 里同步 eval unit 源码，无新桥、无跨线程。unit 拉取走既有 dev HTTP（fetch 范式），与 page chunk 拉取同一通道。 |
| IV 外观照 WeUI | 否 | 不涉及 UI。 |
| V 静默失效是 bug | 是 | 热替换任何一步失败（消息解析不出、unit fetch 失败、eval 抛错）都打日志并回落全量 reload；不认识的新消息格式也回落全量而不是忽略。 |
| VI 注释记录权衡 | 是 | unit 化只发生在 dev、release 保持 IIFE 的原因；输入哈希指纹代替产物哈希的原因——写在 `build.ts` / `server.ts` 新代码顶部。 |
| VII JS 能包就不要下 Dart | 是 | 页面重挂逻辑已在 JS（router）；Dart 只做「fetch → eval → 派事件」，与 `_hotSwapPages` 完全同构，无新增渲染职责。registry 实现放 fjs-runtime（`fjs/dev-units` 导出），由 dev 构建经 shared.js banner 引入。 |
| VIII 变更落到文档 | 是 | `docs/toolchain.md`（dev 行为）、`docs/threading-model.md`（热重载行）、`docs/code-splitting.md`（dev unit 形态）、`docs/web.md`（差异登记）、`docs/roadmap.md`（打勾）。 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI 构建 | `packages/fjs/src/bundler/build.ts` | dev split 分支：① `appModuleGraph` 的 probe 扩展出**模块依赖图**（metafile 的 output 级 `imports` 边）；② 新增 unit 构建——每个共享 app 模块一个文件 `dist/modules/<相对路径>.js`（esbuild 单入口 + 全依赖桩化）；③ shared.js（dev）不再含 app 模块，改为只含 vue/fjs/node_modules/`fjs/dev-units`；④ 新增 `modules.js`（全部 unit 拓扑序拼接，bootstrap 一次 fetch）与每 page chunk / bundle 的 unit 依赖清单；⑤ release / bytecode 路径**一行不动**（unit 构建只在 dev server 调用的分支里）。 |
| CLI 构建 | `packages/fjs/src/bundler/vue-plugin.ts` | `sharedStubPlugin` 增加 unit 桩：registry 集合内的 app 模块 resolve 成 `module.exports = __fjsRequireUnit("<id>")`；bare/`__FJS_SHARED` 桩保持不变。 |
| CLI dev server | `packages/fjs/src/dev/server.ts` | ① 指纹加 `unit:<id>`，且 unit 指纹改为**输入闭包哈希**（transitive 源文件内容哈希），只重建输入变化的 unit；② `changeMessage()` 扩展：变更闭包全为 unit 且 entry 不可达 → `reload units:<ids> pages:<chunks>`（ids 拓扑序、pages 为受影响 chunk），否则维持 `reload`；③ 静态服务 `/modules/<id>.js`、`/pages/<chunk>.deps.json`，manifest 增补对应表。 |
| JS runtime | `packages/fjs-runtime/src/dev-units.ts`（新） | 运行时注册表：`globalThis.__FJS_MODULES`、`__fjsDefineUnit(id, factory)`、`__fjsRequireUnit(id)`（app 模块查注册表、bare 查 `__FJS_SHARED`；缺 unit 告警并抛错 → Dart 回落全量）。经 `fjs` 包导出，dev 构建的 shared.js 头部 import。 |
| C++ 引擎 | — | 不动。`fjs_vm_eval_source` 已够。 |
| Dart 宿主 | `packages/flutter_fjs/lib/src/engine.dart` | ① bootstrap：`shared.js` 之后 eval `modules.js`，再 bundle（split dev 分支）；② page chunk 懒加载前先取 `/pages/<chunk>.deps.json`，eval 未加载的 unit 再 eval chunk；③ 新增 `_hotSwapUnits(dev, units, pages)`：按序 fetch + eval unit（跳过未加载的），然后对每个受影响 chunk 派事件 13——与 `_hotSwapPages` 同构；失败日志 + 回落 `_loadFromDev`。 |
| Dart 宿主 | `packages/flutter_fjs/lib/src/dev_client.dart` | 解析 `reload units:… pages:…` 消息（解析不出 → 全量 reload 回调，日志说明）。 |
| Web 适配 | `packages/fjs/src/dev/server.ts`（`RELOAD_SNIPPET`） | 不改逻辑（非 eval/perf 消息一律 `location.reload()`），确认新消息格式落到这条分支；`docs/web.md` 登记差异。 |
| 文档 | `docs/toolchain.md`、`docs/threading-model.md`、`docs/code-splitting.md`、`docs/web.md`、`docs/roadmap.md` | 见宪法 VIII。 |

fjs-go（`examples/fjs-go`）零改动：热更新路径全在 `FjsEngine`。

## 3. 方案

### 3.1 模块边界怎么来

**选定**：dev split 构建下，把当前 `appModuleGraph` 判入 shared 的 app 模块
（entry 直达 + 被 ≥2 页引用的集合，机制不变）改成**每模块一个 unit 文件**：

```
dist/shared.js      vue / fjs 运行时 / fjs 模块数据 / __FJS_SHARED（不再含 app 模块）
                    + 头部 import 'fjs/dev-units'（注册表实现）
dist/modules.js     全部 unit，拓扑序拼接，每段 __fjsDefineUnit("<id>", factory)
dist/modules/<id>.js 同上但单模块（热替换按个 fetch）
dist/bundle.js      app entry；app 模块 import 桩化为 __fjsRequireUnit("<id>")
dist/pages/<c>.js   与今天相同（独占依赖内联），app 模块 import 同样桩化
```

- unit 的构建 = esbuild 单入口 bundle，`sharedStubPlugin` 把 bare 依赖桩到
  `__FJS_SHARED`、把 registry 集合内的 app 模块桩到 `__fjsRequireUnit`，
  所以产物只含这一个模块，天然是工厂。
- 运行时 `__fjsRequireUnit(id)`：注册表有 → 返回已求值的 exports（单实例
  语义由 factory 只跑一次保证）；没有 → 告警并 throw（Dart 捕获回落全量）。
- 懒加载（页面首次打开）：page chunk 的 unit 依赖闭包由构建期 metafile
  算出，写进 `/pages/<c>.deps.json`（拓扑序）；Dart 在 eval chunk 前补齐
  未加载的 unit。bootstrap 则一次性 eval `modules.js`，无额外往返。
- 依赖图的边：probe build 的 metafile 里每个 output 有 `imports`（指向
  其它 output），input → output 归并即得模块级边。`entry 可达`沿用现有
  `appModuleGraph` 的判定。

### 3.2 热替换的判定与推送

- **指纹**：unit 用输入闭包哈希（transitive 源文件内容哈希）而不是产物
  SHA1——依赖改了但自身输出不变的 unit 不用重建，`fjs dev` 的每次
  onChange 从「重建全部产物」降到「重建输入变化的 unit + 指纹重算」。
  page chunk / bundle / shared 维持产物哈希（它们要重建才能知道变没变）。
- **`changeMessage()`**：变更 unit 集合 ∪ 其 transitive importers 里，
  若 **entry 可达**（比如组件同时被 shell 引用）→ `reload`（全量，兜底）；
  否则推 `reload units:<拓扑序 ids> pages:<受影响 chunks>`。纯 page chunk
  变更继续走既有 `reload pages:` 路径。
- **设备端**：`_hotSwapUnits` 按消息里的序 fetch + eval（不在
  `_loadedUnits` 里的跳过——与 `_hotSwapPages` 的 `_loadedChunks` 检查
  同理），成功后对每个受影响 chunk 派事件 13，JS router 既有
  `onDevPageReload(chunk)` 完成整页重挂（含 parked 页处理）。
- **语义边界**（对应 spec 第 3 节 1–4 条）：页 = 最小重挂边界；entry /
  shell / 路由表 / `app.config.ts` 不可热替换，一律全量；eval 抛错回落
  全量并日志。

### 3.3 被否掉的备选

- **esbuild `format:'cjs'` 拿免费模块边界**：esbuild 只在 ESM/CJS 混合或
  splitting 时才包 `__commonJS`/`__esm` 工厂，纯 bundle 顶层拼接没有边界；
  且换格式波及 release 与字节码链路。否。
- **dev 全量走 vite**：vite 的按需 ESM 依赖浏览器原生 module 加载，
  QuickJS 端得实现动态 import + import map，等于重写一层加载器。否。
- **组件级 HMR（`import.meta.hot` accept、保留组件状态）**：spec 已拍板
  页 = 最小边界。否。
- **热替换代码经 WS 推内容**：现有 HTTP fetch + 指纹 + manifest 基建成熟，
  消息只带 id 避免大包与乱序问题。否。
- **服务端按次拼接 patch bundle**：与逐 unit fetch 二选一，选逐 unit——
  指纹与静态服务基建都在单文件粒度上，拼接文件没法复用指纹缓存。

### 3.4 实现中的偏差（相对 §3.1–3.3）

1. **URL / 磁盘前缀是 `units/` 不是 `modules/`**：`/modules/` 在 dev server
   里已经被 fjs 模块数据（iconmind 的 icons.json 等）占用（spec 013），
   撞不了。unit 文件 `dist/units/<id>.js`、bundle `dist/units.js`、URL
   `/units/…`、`/units.js`。
2. **unit 文件一律 define-only，热替换由 Dart 触发 require**：原设计是
   热替换单文件带 eager `__fjsRequireUnit`，但循环依赖的闭包无论什么
   顺序都会在 eager 时碰到「partner 还没注册」而炸。define-then-trigger
   （Dart 先 eval 全部 unit 文件、再逐个 eval `__fjsRequireUnit(id)`）让
   热替换和 fresh bootstrap 走同一条惰性求值路径，循环依赖天然安全
   （半成品 exports 语义），plan §4 的「循环依赖 → 全量兜底」不再需要。
3. **受影响 page chunk 也要重新 eval**（§3.2 只写了重挂）：chunk 的打包
   代码在 eval 时就把 unit 的 exports 捕获进闭包，只换 unit 不换 chunk
   的话重挂的还是旧组件。`_hotSwapUnits` 现在对每个已加载的受影响 chunk
   fetch + eval（与 `_hotSwapPages` 同机制），然后才派事件 13。
4. **指纹仍是产物 SHA1，重建跳过用输入 mtime**：unit 的输出只依赖自己
   的输入闭包（依赖全部桩化），所以在 build.ts 里加了一个按输入
   mtime/size 的 unit 构建缓存——指纹机制不变，「只重建输入变化的
   unit」由缓存实现。esbuild 的 metafile 路径按 `absWorkingDir: root`
   钉死（esbuild service 可能比 chdir 活得久）。
5. **units 模式经 manifest 协商**（`/manifest.json?units=1` → `units:
   true`）：旧 app 连新 server 拿到的是 classic split 产物，不会在启动时
   撞上不存在的 `__fjsRequireUnit`。
6. **自测中揪出并修掉的三个存量问题**：
   ① `DevClient` 的 URL 用 `Uri.replace(path:)` 拼，字面 `?` 被编码成
   `%3F`，units 握手到 server 手里成了未知路径、落到 15 字节的
   `'fjs dev server\n'` 兜底——fetch 加 `query` 参数分开传；
   ② native `log_line` 用 `strlen` 传长度，`fjs eval` 的成功应答以
   `\u0000` 开头，整个消息在 FFI 边界被截成空串——eval 从来只能收到
   报错、收不到结果；改为显式传长度（natives.cpp / vm.cpp），预编译产物
   （ios/macos xcframework、android jniLibs）已按宪法规则重新生成；
   ③ WS 断线重连后的全量 reload 沿用 connect 时的 units 标志，server 若
   在期间重启（classic 模式）就 500——reload 前重读 manifest 重新协商。

## 4. 风险

- **循环依赖**：ESM 循环 import 在 unit 化（CJS 工厂语义）下行为可能改变。
  probe 期检测环：命中环的模块变更一律回落全量 reload，并 `warnOnce`。
- **共享模块的单实例**：unit 化后 app 模块只剩注册表一份（比今天
  「shared 快照 + page chunk 内联各一份」更严格），行为应更对而不是更错，
  但 hello-fjs 全页面回归必须过。
- **dev rebuild 变慢**：unit 构建引入 M 次 esbuild 调用；靠输入闭包指纹
  只重建变化 unit 兜住。若 hello-fjs 实测 onChange 明显变慢，plan B 是
  unit 构建结果按输入哈希缓存（任务里预留）。
- **静默失效点**（宪法 V，逐条都有对应对策）：deps.json 拉取失败 →
  回落全量；消息格式不认识 → 回落全量 + 日志；`__fjsRequireUnit` 缺 unit
  → 告警 + 抛错 → Dart 回落全量。
- **两端对拍**：web 端只验证「不回归」（收到变更 → 整页 reload）；模块级
  行为只在 App 端验（差异已登记）。

## 5. 验证路径

```bash
pnpm run typecheck && pnpm test
# 冒烟：split 产物形态
cd examples/hello-fjs && pnpm exec fjs build --pages
ls dist/modules dist/pages/*.deps.json && head -20 dist/modules.js
# 离线跑 bundle（release 路径回归）
cd packages/flutter_fjs/native && ./build-native/fjsrun ../../../examples/hello-fjs/dist/bundle.js
# 设备验证（spec 6 节 3–6 条）
cd examples/hello-fjs && pnpm exec fjs dev
#   改页面 .vue → reload pages:…（原路径）
#   改被两页引用的组件 → reload units:… pages:…，VM 不重建、页面栈保留
#   改 main.ts / app.config.ts → 全量 reload
#   unit eval 故意抛错 → 日志 + 回落全量，不白屏
pnpm exec fjs dev --web   # 行为不回归
```
