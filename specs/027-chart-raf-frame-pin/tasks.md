# Tasks: 图表适配层不再钉住宿主帧管线

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 **不涉及**。三张契约表一张都不动（plan §1 条款 II）：不新增 op、
      不新增 native、不新增事件类型，用的全是既有的 `js.raf.request`
      （`packages/fjs-runtime/src/raf.ts`）与 `setTimeout`。
      这条留着是为了让「确认过不涉及」和「忘了看」有区别（宪法 V）。

## 实现

- [x] T010 在 `examples/hello-fjs/src/f2/adapter.ts` 里加一个**帧时钟门控**
      工厂（每张图一个实例，闭包持有自己的状态）：
      - 自发 id + `Map<number, () => void>` 存 cancel thunk，因为宿主 rAF 的
        id 空间和 `setTimeout` 的会撞（plan §3）；
      - `requestAnimationFrame(cb)`：活跃走真 rAF，空闲走 `setTimeout(cb, IDLE_MS)`；
      - `cancelAnimationFrame(id)`：查表调对应 thunk；
      - 导出一个 `arm()`，把「活跃期」推到现在。
- [x] T011 接上 `rerender` 信号：`createF2Chart` 里拿 `f2.context.canvas`
      （f-engine 把 GCanvas 挂在这），`addEventListener('rerender', ...)` 里
      刷新 `lastPaint`。**先确认这条路径在运行时真的可达**（`IContext` 是
      `[key: string]: any`，不是 F2 的公开契约）。
- [x] T012 降级路径（宪法 V）：T011 那条路拿不到时 `console.warn` 一次，
      门控整体退回「一直用宿主 rAF」= 今天的行为。**不能静默变成图表不动**。
- [x] T013 补「有正在跑的动画」这一路信号：`gCanvas.document.timeline`
      （`Document.d.ts` 里是公开的 `readonly timeline`）。活动动画列表在
      `IAnimationTimeline` 接口上没暴露、运行时有 —— **确认可达就用，
      拿不到就只留 GRACE 窗口，不要写反射式取值**（plan §3）。
- [x] T014 三处「重新武装」调 `arm()`：`createF2Chart` 建图之后、
      `handleTouch` 每次进来、`resize()` 里。这是本页所有能让场景变化的入口，
      慢轮询因此只是安全网。
- [x] T015 把裸的 `requestAnimationFrame: globalThis.requestAnimationFrame?.bind(...)`
      / `cancelAnimationFrame` 换成门控版传给 `new Canvas({...})`。
- [x] T016 写注释（宪法 VI）：为什么不能一直用宿主 rAF（每次申请 = 强制
      Flutter 出一帧）、为什么不能干脆换 `setTimeout`（动画掉到 ~35fps，
      web 也跟着退化）、GRACE / IDLE_MS 为什么取这两个值。密度照该文件顶部
      既有注释。

## 两端对齐

- [x] T020 **无对侧实现**：门控写在 `examples/hello-fjs/src/f2/adapter.ts`
      一个文件里，两端跑同一份，`globalThis.requestAnimationFrame` 在 App 上
      是宿主帧回调、web 上是浏览器 rAF。确认代码里没有 `__fjs` / `HTMLCanvasElement`
      之类的平台分叉进到门控逻辑（plan §1 条款 I）。
- [x] T021 两端行为对拍。
      **Android：四项全过**（截图在 scratchpad）——入场动画 ✓、按住出 tooltip
      ✓（长按拖动截到「三: 90」跟手）、拖动跟手 ✓、饼图点选 ✓（点「搜索」扇区，
      其余三块淡到 0.3）。
      **Web：渲染与入场动画过**（连拍两帧截到柱子从 0 长起来 → 完成态），
      **帧率数字本环境测不了**：应用内浏览器面板的 `document.visibilityState`
      恒为 `hidden`，浏览器把 rAF 挂起，任何 fps / clearRect 速率都不可信；
      用户的 Chrome 扩展未连接，换不了真浏览器。
      → 见 T060，这条留给用户在真浏览器上收口。
- [x] T022 `examples/hello-fjs/src/echarts/adapter.ts` 加注释：zrender 的 rAF
      在**模块加载期**就按 `env.hasGlobalWindow` 定死退化成 `setTimeout(f, 16)`，
      它天然跑在 16ms pump 上、不占帧 —— 别「顺手统一成宿主 rAF」。

## 测试

- [x] T030 落一份可复用的探针（放 scratchpad，不进仓库）：包
      `globalThis.requestAnimationFrame` 与 `setTimeout` 计数，包 ctx 的
      `clearRect` / `fill` / `stroke` / `fillText` 数 `paints/s`、`cmds/s`，
      每秒 `console.log` 一次，`adb logcat -s flutter:V` 读。
      **前后必须用同一份探针对比**（它自己有成本）。
- [x] T031 基线复测：改动前的 `/example/f2` 与 `/example/echarts` 各测一遍，
      确认能复现 spec §1 的数字（F2 `raf/s=180 paints/s=0`；ECharts `raf/s=0`）。
- [x] T032 改动后复测同样两页，记录数字。F2 页进场后稳态
      **raf/s=0、timer/s=15（3 图 × 200ms 轮询）、paints/s=0**；
      入场那一秒 raf/s=200、paints/s=75、cmds/s=1850（该快时仍然快）。
      ECharts 页不变（raf/s=0）。
- [x] T033 push 转场 CPU：`/proc/<pid>/stat` 的 `utime+stime`，
      `tap → +2s` 窗口，**跑 3 次取中位数**（模拟器单次波动可达 ±15%，
      plan §4）。F2 与 ECharts 同口径各测一组。
      **实测发现口径要改**：跨会话不可比（同一份 echarts 测出 480~640ms），
      改成同会话 A/B，spec §6.4 与 plan §4 已同步重写。
      同会话结果（中位数，无探针）：F2 门控关 **920ms** → 门控开 **750ms**
      （−18%），echarts 对照 **640ms**（F2 高出 17%，< 20%）。
- [x] T034 删干净探针，`git status --short` 只剩预期改动。

## 文档

- [x] T040 `docs/canvas-compat.md` §12.3 改写。现在那句「G 的动画时钟走
      `requestAnimationFrame`，App 上那是宿主的帧回调，把它传进 `new Canvas`
      就行」**正是这个 bug 的来源**，换成正确接法并说明为什么。
- [x] T041 `docs/canvas-compat.md` F2 一节补一条：空闲不占帧的门控怎么做、
      web 后台标签页 `setTimeout` 被节流到 1s 是预期不是 bug（plan §4）。
- [x] T042 `docs/threading-model.md` 新增「requestAnimationFrame」一节：
      它是宿主帧回调，`scheduleFrameCallback` + `ensureVisualUpdate()`，
      **申请一次就强制出一帧**；与 §「泵」那条 16ms `Timer.periodic` 是两条
      独立时钟；库适配层什么时候该用哪条。
- [x] T043 `docs/performance.md` 记本次实测：空闲 `raf/s` 180 → 实测值、
      push 转场 CPU 840ms → 实测值、ECharts 对照 510ms，并注明「3 次中位数」
      的量法。
- [x] T044 `docs/roadmap.md`「canvas（已完成 2026-09）」一节的 F2 条目下补了
      spec 027 的结论（原本没有对应条目，新增一条）。

## 验收

- [x] T060 **已收口**（2026-09-10，见 spec §8c）：入场动画三张图各 ~60fps
      （中位间隔 16.6-16.7ms，max 29-30ms），web 侧没有退化。原步骤：
      `pnpm --filter hello-fjs run dev:web` 打开 `http://localhost:5175/#/example/f2`，
      开 DevTools Performance 录 3 秒，核对两件事：
      1. 入场动画期间帧间隔 ~16ms（不是 ~28ms）；
      2. 动画结束后静置，Main 线程应基本空闲（改动前是每帧都有 G 的 tick）。
      判定标准见 spec §4「web 侧不能因为这次改动退化」。

- [x] T050 `pnpm --filter hello-fjs run typecheck`
- [x] T051 `pnpm test` 不回退
- [x] T052 spec.md 第 6 节逐条核对（8 条），把实测数字填回 spec，
      状态改为 done
- [x] T053 另开 spec 的两条挂账（spec §7）：Dart 侧「无 op 就不 notify」、
      「静止页面也在 60fps 出帧」—— 确认已记在某处，不要随本 spec 关掉就丢了

## 复测后新增（2026-09-10 晚）

- [x] T061 改用帧间隔复测转场（`dumpsys SurfaceFlinger --latency` 算相邻帧差），
      发现 §3.1 未达成：每次 push 固定在第 2 帧停顿 ~205ms。见 spec §6c。
- [x] T062 定位停顿来源：F2 首帧渲染约 70ms/张 × 3 张，`f2.render()` 的
      await 之后那一段；`new Canvas()` 本身只要 2-4ms。ECharts 同口径 19/10/9ms。
- [x] T063 因果验证：`mount*` 延后 400ms → 转场前 25 帧干净 16-17ms，
      停顿原样搬到转场之后。
- [x] T064 `docs/performance.md` 补「量路由动画要量帧间隔，不要量 CPU」的量法与教训。
- [x] T070 定方案：用户 2026-09-10 决定 **(a) 和 (b) 都做，就在本 spec 里改**，
      不另开。spec §8、plan 第二轮、下面的任务组都是这次加的。

# 第二轮任务：把重活挪出转场（spec §8 / plan 第二轮）

## 契约层（先做，两侧都依赖）

- [x] T101 `packages/flutter_fjs/native/include/fjs.h`：`FJS_EVENT_NAV_SETTLED = 31`
- [x] T102 `packages/flutter_fjs/lib/src/ffi.dart`：`FjsEvent.navSettled = 31`，
      注释写清「无 payload，nodeId 是路由 key」，并说明为什么不进
      `element.ts` 的 `EventType`（nav 系列都是系统事件）

## 实现 —— Dart 侧 (a)

- [x] T110 `fjs_app.dart`：把 `onSettled` 像既有的 `onDispose` 一样穿过
      `_FjsMaterialPage` / `FjsTransitionPage`，传到
      `_FjsMaterialPageRoute` / `_FjsPageRoute` / `_FjsCupertinoPageRoute`
- [x] T111 三个 Route 类各覆盖 `didPush()`：`super.didPush()` 的 `TickerFuture`
      结算时回调 `onSettled(navKey)`。用 `whenCompleteOrCancel` —— 转场中途被
      打断（还没走完就 pop）也要结算，否则页面永远等不到
- [x] T112 `engine.dart`：`onRouteSettled(key)` → `dispatchEvent(key, FjsEvent.navSettled)`，
      并在 `_buildPage` 处把它接上

## 实现 —— Dart 侧 (b)

- [x] 0 `widgets/canvas.dart`：**首次** `_reportSize` 等
      `ModalRoute.of(context)?.animation` 完成再派；没有 route（初始页）或动画
      已完成就照旧立即派。第二次起（真尺寸变化）不受影响
- [x] 0 注释写清为什么只推迟首次（宪法 VI）

## 实现 —— JS 侧 (a)

- [x] T120 `router/flutter.ts`：`EVENT_NAV_SETTLED = 31` 的 handler；
      `PageEntry` 加 `settled` + 待跑回调队列
- [x] T121 `router/flutter.ts`：导出 `onPageSettled(cb)`。已 settled 时回调走
      **下一个微任务**，不同步跑
- [x] T122 `router/flutter.ts`：初始页 / tab replace / `transition: 'none'`
      立即 settled
- [x] T123 `router/flutter.ts`：1s 兜底 + `warnOnce`（宪法 V）。页面卸载后
      不再触发，定时器要清
- [x] T124 `router/types.ts`：`onPageSettled` 的类型

## 两端对齐 —— JS 侧 (a)(b) 的 web 一半

- [x] T130 `app/web.ts`：`<Transition>` 加 `onAfterEnter` → 标记 settled；
      `transition === false` / `NO_TRANSITION` 立即 settled
- [x] T131 `router/web.ts`：`onPageSettled` 的 web 实现，语义与 Flutter 一致
      （一次性、已 settled 走微任务、卸载后不触发）
- [x] T132 `web/components/canvas.ts`：(b) 的 web 一半——首次 resize 等最近的
      `fjs-page-entry` 祖先 `transitionend`，带超时兜底
- [x] T133 两端对拍：`onPageSettled` 在「有转场 / 无转场 / tab 切换」三种情况
      下两端都触发且只触发一次

## 测试

- [x] T140 `fjs-runtime` 加单测：`onPageSettled` 的一次性、已 settled 走微任务、
      卸载后不触发、兜底会 warn
- [x] T141 先编 native（`cmake -B build-native -DFJS_BUILD_TESTS=ON && cmake --build build-native -j`），
      再 `cd packages/flutter_fjs && flutter test`。**确认输出是用例数而不是
      `No tests ran`**（AGENTS.md §3）
- [x] T142 `cd examples/hello-fjs && pnpm run run:android` 重编——Dart 改动
      热重载覆盖不到，不重编测的是旧宿主

## 验收（第二轮）

- [x] T150 帧间隔复测：push 进 `/example/f2`，2.5s 窗口内**没有 > 33ms 的间隔**，
      序列与 `/example/echarts` 同形。跑 3 次，贴原始序列
- [x] T151 ~~源码零改动~~ **改成开关了**（用户 2026-09-10）：`defer-resize`
      默认关，`f2.vue` 三个 canvas + webgl/three 三页各一个显式打开，共 +6 行。
      `echarts.vue` 不开，保持原样。图表照常出现（截图已核）
- [x] T152 §3 的四项行为两端复核一遍
- [x] T153 `pnpm --filter hello-fjs run typecheck` + `pnpm test`

## 文档

- [x] T160 `docs/ui-api.md`：`onPageSettled`
- [x] T161 `docs/canvas-compat.md`：首次 `@resize` 的时机变了
- [x] T162 `docs/threading-model.md`：转场期间别干重活，给出 `onPageSettled`
- [x] T163 `docs/roadmap.md` 补一条

## 开关化追加（2026-09-10，用户要求默认不延迟）

- [x] T170 `<canvas>` 新增布尔属性 `defer-resize`，默认关。
      `components/canvas.ts` 把它从 attrs 里摘出来传给绘制面（不能落在 box 上）
- [x] T171 `widgets/canvas.dart`：`fjsBool(props['deferResize'])` 为真才等
      `ModalRoute` 的动画；否则照旧立即派
- [x] T172 `web/components/canvas.ts`：同一个开关
- [x] T173 `vue-global.d.ts`：`FjsCanvasProps` 加 `defer-resize` / `deferResize`
      的类型与文档注释（不加的话页面写了会 TS2353）
- [x] T174 示例页打开开关：`f2.vue` ×3、`webgl.vue`、`three-gltf.vue`、
      `gltf-viewer.vue`。`echarts.vue`、`gomoku.vue`、`tetris.vue`、
      `comp/canvas.vue` 保持默认关
- [x] T175 同会话 A/B 验证开关两侧（见 spec §8b）：关 → 第 2 帧就卡；
      开 → 前 12-17 帧干净

## 第一轮回滚（2026-09-10，用户决定）

- [x] T080 撤回帧时钟门控：`git checkout examples/hello-fjs/src/f2/adapter.ts`，
      T010–T016 的改动全部回退。理由：它修的不是用户看到的卡顿（真凶见
      spec §6c），实测收益只有空闲约 2% CPU，且给「绕过适配层改场景」引入最多
      200ms 延迟。**T010–T016 / T030–T034 的勾保留为历史记录，但代码已不在树上。**
- [x] T081 `echarts/adapter.ts` 的注释保留，但改掉错误归因（原本写「F2 就是踩了
      这个……路由转场跟着掉帧」），改成「F2 页现在就是这个状态，约 2% CPU
      的纯浪费，已知未修」
- [x] T082 文档同步去掉战功：`canvas-compat.md` §12.3 改成「已知代价，未修」+
      为什么撤；`threading-model.md` 的指引保留但指出 F2 示例没做第 2 条；
      `performance.md` 那节改写成「一次归因错误」+ 两条教训；
      `roadmap.md` 的 ✅ 改成 ⏳ 已知未修
- [x] T083 spec 同步：§1 重写成「记录一次归因错误」，§3 去掉「不再持续申请宿主
      帧回调」那条目标，§4/§5 指向第二轮，§6 验收改成量帧间隔，
      §6b 表格里第 3/4 条标作废；plan 第一轮整段加「已作废」横幅

## 示例补充（2026-09-10，用户要求）

- [x] T090 新增示例页 `examples/hello-fjs/src/pages/example/page-settled.vue`
      （「交互演示 → 转场与重活」）：`onPageSettled` 的可跑演示，同一页用
      `?mode=settled|now` 切「等转场 / 立刻干」，故意同步阻塞 200ms 当重活，
      页面上打时间线。实测 `onPageSettled` 在 **+397ms** 触发（= Android 转场
      时长），帧间隔 A/B：等转场 = 转场 20 帧干净、重活落在之后；
      立刻干 = 294ms 压在第 1 帧
- [x] T091 页面里同时演示「离场那一侧」：两端都没有单独钩子，`onUnmounted`
      就是离场动画之后的时机（Flutter `route.dispose()` → `navPop`，
      web `onAfterLeave` → KeepAlive 丢弃）。logcat 已验证
- [x] T092 `docs/ui-api.md` 的 `onPageSettled` 一节补上离场侧说明 + 示例页指路
      + 实测帧序列
