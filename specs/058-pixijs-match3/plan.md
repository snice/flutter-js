# Plan: hello-fjs 增加 PixiJS 示例 —— 消消乐（match-3）

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 涉及 | 页面一份源码两端跑：context 取法、触摸载荷、布局数学完全一致；平台差异全部收进 `@/pixi/native-shims`（原生宿主安装垫片，web 上按 `hasNativeHost` 整体 no-op，模式同 racing 的 `three/native-polyfills.ts`）。 |
| II 边界即契约 | 不涉及 | 不动 op 协议 / natives 表 / 事件类型三张表。 |
| III 同步单线程零序列化 | 不涉及 | 全部跑在 JS 引擎单线程里，渲染走既有 op 11 命令流。 |
| IV 外观照 WeUI | 不涉及 | 游戏页画布内是自绘图形；画布外 UI（按钮/文本）用既有 fjs 组件，取主题变量，不新增默认样式。 |
| V 静默失效是 bug | 涉及 | 启动失败（无 webgl、context 不 ready、pixi 抛错）都要落到页面状态文本上；垫片补的每个 API 写注释说明是 pixi 哪条路径需要。 |
| VI 注释记录权衡 | 涉及 | 垫片模块顶部注释记录"为什么伪造 WebGL2RenderingContext 原型链"（pixi validateContext 的 instanceof 判定，从 7.4.3 源码摘引）；页面注释记录输入不走 EventSystem 的原因。 |
| VII JS 能包就不要下 Dart | 满足 | 零 Dart/C++ 改动；全部能力在 JS 示例层，GL 由既有 `@ufjs/webgl` 承载。 |
| VIII 变更落到文档 | 部分 | 无协议/样式/CLI 变更；hello-fjs README 补一条示例说明。 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| 示例依赖 | `examples/hello-fjs/package.json` | 新增 `pixi.js@^7.4.3`；`fjs.mp.exclude` 加 `example/game/match3` |
| 示例：垫片 | `examples/hello-fjs/src/pixi/native-shims.ts` | 新建。原生宿主的 navigator / document / globalThis.addEventListener / performance 垫片 + `adoptNativeWebgl2Context(ctx)`（原型链挂到伪造 `WebGL2RenderingContext`、补 `getInternalformatParameter` 桩） |
| 示例：模型 | `examples/hello-fjs/src/match3/model.ts` | 新建。纯函数棋盘模型：初始布局（无现成三消、必有可行步）、三消检测、交换校验、下落/补充、死局检测、重排、可行步查找（提示用） |
| 示例：页面 | `examples/hello-fjs/src/pages/example/game/match3.vue` | 新建。Pixi Application 生命周期、fjs touch → 格子换算、手写 tween（ticker 驱动）、状态机（idle/swapping/resolving/shuffling）、画布外 fjs UI |
| 文档 | `examples/hello-fjs/README.md` | 示例清单补一行 |

不动的层：`packages/fjs`、`packages/fjs-runtime`、`packages/fjs-webgl`、
`packages/flutter_fjs`（JS/Dart/C++ 全不改）。

## 3. 方案

### 3.1 PixiJS 启动路径（从 pixi.js 7.4.3 源码核实的硬事实）

`examples/hello-fjs/src/pixi/native-shims.ts` 只在 `hasNativeHost` 时安装，
web 上 no-op。原生宿主需要补的东西，每一条都对应 pixi 7.4.3 的具体代码：

1. **`instanceof WebGL2RenderingContext`** —— `ContextSystem.validateContext`
   用它判版本；判成 WebGL1 会走扩展对象路径（`extensions.drawBuffers` 等），
   而 `getExtension` 在桥上恒为 null → 后续崩。垫片定义
   `globalThis.WebGL2RenderingContext`（空类）并把桥 context 的原型链挂上去。
2. **`gl.getInternalformatParameter`** —— `FramebufferSystem.contextChange`
   在 GL2 分支**立即调用**（`msaaSamples = gl.getInternalformatParameter(...)`），
   桥没实现 → 首帧 TypeError。垫片补桩（返回空数组；页面不用
   RenderTexture/MSAA，无人消费）。
3. **`navigator`** —— `EventSystem.addEvents` 无条件读
   `globalThis.navigator.msPointerEnabled`（三元第一分支），缺了直接抛。
   桩对象给 `userAgent`/`platform`/`maxTouchPoints`。
4. **`document`** —— EventSystem 走 mouse 路径时
   `globalThis.document.addEventListener('mousemove'|…)`,桥宿主没有
   document。桩上 addEventListener/removeEventListener 是 no-op ——
   pixi 的事件钩子被有意绕过（见 3.3）。
5. **`globalThis.addEventListener/removeEventListener`** —— EventSystem
   和 `ResizePlugin.destroy` 都会碰。
6. **`performance.now`** —— Ticker 的时间源（条件安装，racing 同款）。

页面按 three-gltf.vue 的既定模式取 context：

```ts
const ctx = (canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
adoptNativeWebgl2Context(ctx)          // 仅原生宿主做事
new Application({ view: asDomCanvas(ctx.canvas), context: ctx,
                  width, height, resolution: bufferRatio(...), antialias: true })
```

`asDomCanvas` / `bufferRatio` 照抄 three-gltf.vue 的语义（buffer 尺寸读
`gl.canvas` 而不是元素；元素 devicePixelRatio 在 2d 契约上是常数 1）。

### 3.2 玩法与结构

- 棋盘 8×8、6 色；`model.ts` 纯函数 + 显式 rng（默认 Math.random），
  不依赖 pixi/Vue，页面只消费步骤列表做动画。
- 状态机：`idle → swapping → resolving（消除/下落/补充循环，连击计分）
  → idle`；每次回 idle 检死局，死局自动 shuffle。
- 输入：`@touchstart/@touchmove/@touchend` → offsetX/offsetY → 格子。
  tap=选中/交换，move 位移超过半格=朝该方向交换（经典消消乐手势）。
- 动画：页面内 ~40 行 tween 小工具（对象+插值+时长+onDone），
  ticker 每帧推进；不引 gsap（spec Non-goal：不新增依赖）。
- 得分/连击/提示/重开都在画布外用 fjs 组件（`<text>`/`<button>`），
  不用 Pixi Text（会拉 `document.fonts` / TextMetrics 的 DOM 路径）。
- 不用 Pixi mask（stencil 路径在桥上未验证）。

### 3.3 被否掉的备选

- **整体移植 pixi-game-match3**（含 assetpack、pixi-spine、@pixi/ui、
  @pixi/sound、gsap）：racing 量级 + 4 个新依赖，其中 pixi-spine 与
  @ufjs/spine 重复建设。用户判据下这是"太大"的情形，留作后续独立项目。
- **单独建 examples/pixi-match3**：紧凑版没必要 —— hello-fjs 现有
  tetris/大西瓜都是从参考实现自写紧凑版放示例区，本页照此办理。
- **pixi.js v8**：WebGPU 优先、DOM 假设更多（`document` 更深）、API
  重构；参考仓库和本仓验证目标（WebGL 桥）都对不上 v7。
- **接入 Pixi EventSystem 做命中测试**：要伪造 PointerEvent 全家 +
  双端 document 语义，复杂度全在垫片里；页面算格子只要 10 行，
  且和 spine.vue 的触摸模式一致。
- **贴图素材（Assets/ImageBitmap 路径）**：three.js glTF 已验证过
  纹理上传；本次的验证点是 pixi 本体，零素材把变量减到最少。

## 4. 风险

- **原型链补丁的时序**：必须在 `new Application` 之前完成；放
  `adoptNativeWebgl2Context(ctx)`，页面在取到 ctx 后立刻调用。
  判成 WebGL1 的失败模式是黑屏或扩展对象 TypeError，不是安静降级。
- **连续 ticker 的 present 路径**：three-gltf 用按需渲染绕开了
  Android 路由转场问题（spec 023）；本页需要连续帧，iOS 上若黑屏
  要先查 `gl.flush`（spec 028 present 路径）而不是渲染本身。
- **stencil**：`getContextAttributes` 若报无 stencil，Pixi mask 会坏 ——
  设计上已避开 mask；万一后续要 mask，先把桥的 stencil 支持补上。
- **keep-alive**：路由是 keep-alive 的（spine.vue 注释），离开页面必须
  `ticker.stop()`，回来 `ticker.start()`，否则后台仍每帧发 GL 命令。
- **iOS 模拟器工具链**：`fjs run ios` 需要 `.fjs/flutter` 宿主 +
  xcodebuild；本机已有 booted iPhone 17 Pro（iOS 26.3）。若宿主缺失，
  `fjs run` 会自行 `flutter create`，首次构建耗时较长属预期。

## 5. 验证路径

```bash
# 1. 依赖 + 类型
pnpm install
pnpm --filter hello-fjs run typecheck

# 2. Web（浏览器人工/自动化走查 match3 页）
pnpm --filter hello-fjs run dev:web     # 打开 /pages/example/game/match3

# 3. 回归
pnpm test
pnpm --filter hello-fjs run build:mp    # 确认 exclude 生效、构建通过

# 4. iOS 模拟器
pnpm --filter hello-fjs run run:ios     # 已启动的 iPhone 17 Pro 上操作 + 截图
```

## 6. 追记：fjs（esbuild）构建解析不了 node 内置模块（实现中发现）

fjs 的 app 构建（`fjs dev` / `fjs build`）是 esbuild + `platform: 'neutral'`
（build.ts `flutterEsbuildPlatform`）：node 内置模块一律不解析。pixi 的依赖图
里 `@pixi/utils/lib/url.mjs` 顶部 `import { parse, format, resolve } from "url"`
（npm `url` 垫圈包 → qs → side-channel → object-inspect → `require("util")`），
import 是急切的 → dev server 对 `bundle.js` 返回 500、`fjs build` 直接失败。
Vite（`dev:web`）没事，它对 node 内置模块有浏览器空桩机制。

**选定方案（落在 CLI，通用能力）**：`packages/fjs/src/bundler/build.ts` 新增
`nodeBuiltinStubs()` esbuild 插件——把 node 全部内置模块（含 `node:` 前缀与
子路径）resolve 到一份 CJS 桩：`module.exports` 是个 Proxy，任何属性读都返回
"调用即抛"的函数。急切的命名转发（`import { parse } from "url"`）、特性探测、
`require('util').inspect` 存着不调用都能过构建；真调用大声报错（宪法 V）。
插件接进全部六处 esbuild 构建（单包 / probe / shared / app+page / units /
web esbuild）。`fjs` bin 跑的是 dist 产物，改完要 `pnpm --filter @ufjs/cli
run build`。文档落在 docs/toolchain.md「构建」章节。

**否掉的备选**：示例层 tsconfig paths 把 `url` 指到本地桩 —— esbuild 的
paths 只作用于 tsconfig 目录树内的文件，node_modules/.pnpm 里的依赖文件吃不
到（实测无效）；改 CLI 把内置模块统一 alias 成空模块的旧想法 —— 与本方案
合并了（空模块会在急切命名 import 处构建报错，Proxy 桩才是对的）；pnpm
overrides 强改 `url` 版本 —— 所有 0.11.x 都依赖 qs，治不了根。
