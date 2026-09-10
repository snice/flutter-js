# Plan: 重活不再压在路由转场上（F2 图表页卡顿）

对应 spec：`./spec.md`

> **读这份文件前先看这条**：下面「第一轮」整段是**已作废的方案**——按「渲染
> 活跃期」门控帧时钟。它实现过、验证过，但事后证明它修的不是用户看到的那个
> 卡顿（真凶见 spec §6c），收益只有空闲时约 2% CPU，2026-09-10 由用户决定
> 撤回。保留在这里是因为它记录了「为什么不这么做」，以及那次归因错误的
> 完整过程。
>
> **真正落地的方案在本文件末尾的「第二轮」**：`onPageSettled` +
> `<canvas defer-resize>`。

---

## 第一轮（已作废）

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 涉及 | 只改 `examples/hello-fjs/src/f2/adapter.ts` **一个文件**，两端跑的是同一份。门控逻辑不分平台：`globalThis.requestAnimationFrame` 在 App 上是宿主帧回调、web 上是浏览器 rAF，两边都只在「渲染活跃期」才用它。不需要在 `fjs-runtime/src/web/` 加对侧实现——本次没有新增框架能力。 |
| II 边界即契约 | 不涉及 | 三张表一张都不动：不新增 op、不新增 native、不新增事件类型。用的全是既有的 `js.raf.request`（`raf.ts`）和 `setTimeout`。 |
| III 同步单线程零序列化 | 涉及（正向） | 本 spec 就是在还这条的债：现在每秒 180 次 JS↔Dart 往返里 100% 是空转。改完只在真的要画时才过桥。不引入任何 JSON 桥或跨线程等待。 |
| IV 外观照 WeUI | 不涉及 | 不碰内置组件样式。 |
| V 静默失效是 bug | 涉及 | 门控依赖 `f2.context.canvas`（f-engine 的 `IContext` 是 `[key: string]: any`，不是稳定公开 API）。拿不到就 `console.warn` 一次并**退回今天的行为**（一直用宿主 rAF），不能静默变成「图表不动了」。 |
| VI 注释记录权衡 | 涉及 | `f2/adapter.ts` 里那段门控要写清楚：为什么不能一直用宿主 rAF（每次申请 = 强制 Flutter 出一帧）、为什么不能干脆换 `setTimeout`（动画掉到 ~35fps）、grace 窗口为什么是这个值。写法照该文件顶部既有注释的密度。 |
| VII JS 能包就不要下 Dart | 涉及（结论：不下 Dart） | 这次一行 Dart 都不改。判据满足：要的信息（「刚才那一 tick 到底画没画」）JS 侧全有——g-lite 的 `rerender` 事件就是它。Dart 侧那条更通用的优化（`dispatchEvent` 无 op 时不 `notifyListeners()`）已在 spec §7 明确划到另一个 spec。 |
| VIII 变更落到文档 | 涉及 | `docs/canvas-compat.md` §12.3 改写 + 新增一条、`docs/threading-model.md` 新增「requestAnimationFrame」一节、`docs/performance.md` 记本次实测。 |

无破例项。

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | — | 不动 |
| JS runtime | — | 不动（`packages/fjs-runtime/src/raf.ts` 保持原样，见 §3 否掉的备选 3） |
| Web 适配层 | — | 不动 |
| C++ 引擎 | — | 不动 |
| Dart 宿主 | — | 不动 |
| 页面 / 示例 | [`examples/hello-fjs/src/f2/adapter.ts`](../../examples/hello-fjs/src/f2/adapter.ts) | 新增帧时钟门控：把喂给 `new Canvas({ requestAnimationFrame })` 的函数从裸的宿主 rAF 换成门控版；`handleTouch` / `resize` 里补一次「重新武装」 |
| 页面 / 示例 | [`examples/hello-fjs/src/echarts/adapter.ts`](../../examples/hello-fjs/src/echarts/adapter.ts) | 只加注释：说明 zrender 的 rAF 在模块加载期就退化成 `setTimeout` 了，它天然在 pump 上，不要「顺手改成宿主 rAF」 |
| 文档 | [`docs/canvas-compat.md`](../../docs/canvas-compat.md) | §12.3「把它传进 `new Canvas` 就行」改写；F2 一节补一条讲空闲不占帧 |
| 文档 | [`docs/threading-model.md`](../../docs/threading-model.md) | 新增一节：rAF 是宿主帧回调、会 `ensureVisualUpdate()` 强制出帧，与 §「泵」的 16ms `Timer.periodic` 是两条独立时钟；库适配层怎么选 |
| 文档 | [`docs/performance.md`](../../docs/performance.md) | 记本次实测：空闲 `raf/s` 180→目标 <5、push 转场 CPU 840→≤600ms、ECharts 对照 510ms |

## 3. 方案

### 选定：按「渲染活跃期」门控帧时钟

关键发现（读 `@antv/g-lite` 与 `@antv/g-web-animations-api` 源码得到）：

1. **动画时钟本来就是按需的。** `AnimationTimeline.rAF()` 只在
   `rafCallbacks.length === 0` 时才向 `document.defaultView.requestAnimationFrame`
   （= 我们传进去的那个函数）要一帧，没有动画就不要。
2. **不按需的只有一个地方**：`Canvas.run()` 的
   `tick(){ render(); frameId = raf(tick) }` —— 无条件自续，永不停。
3. **「这一 tick 到底画没画」有现成信号**：`RenderingService.render()` 只在
   `renderReasons.size && inited` 时才调 `rerenderCallback()`，g-lite 于是
   dispatch 一个 `rerender` 事件（`CanvasEvent.RERENDER = 'rerender'`）。
   空转的 tick 不会有这个事件。

所以做法是：**不动 G 的循环，只换它手里的表**。

```
gCanvas = f2.context.canvas                     // f-engine 把 GCanvas 挂在这
gCanvas.addEventListener('rerender', () => lastPaint = now())

我们喂给 new Canvas 的 requestAnimationFrame(cb):
  活跃 = (now() - lastPaint < GRACE) || 有正在跑的动画
  活跃 → 真 rAF（宿主帧回调 / 浏览器 rAF），60fps，该占帧就占
  空闲 → setTimeout(cb, IDLE_MS)，纯兜底轮询
```

- **重新武装**（把 `lastPaint` 推到现在）的时机：`createF2Chart` 建图后、
  `handleTouch` 每次进来、`resize()`。这三个是这个页面里**所有**能让场景变化
  的入口，所以慢轮询只是安全网，不是主要路径 —— 交互延迟不会退化。
- **`GRACE`**：要盖住「动画中某一帧恰好没产生 rerender」（F2 入场动画有
  stagger 延迟）。初值 300ms，验收第 5 条人眼核对入场动画时确认。
- **「有正在跑的动画」**：`gCanvas.document.timeline`（`Document.d.ts` 里是
  `readonly timeline: IAnimationTimeline`，公开）。它的活动动画列表在
  `IAnimationTimeline` 接口上没暴露，运行时有。/tasks 阶段先确认可达；
  **拿不到就只用 GRACE 窗口**，不要为它写反射式的取值。
- **`cancelAnimationFrame` 的 id 空间**：宿主 rAF 的 id 和 `setTimeout` 的 id
  是两套、会撞。适配层自己发 id，用一个 `Map<number, () => void>` 存 cancel
  thunk，G 拿到的永远是我们的 id。
- **降级**：`f2.context?.canvas?.addEventListener` 不可用时 `console.warn` 一次
  并原样使用宿主 rAF（= 今天的行为）。宁可慢，不可不动（宪法 V）。

### 否掉的备选

1. **直接换成 `setTimeout(cb, 16)`。** 已实测有效（push CPU 840→600ms，
   `raf/s` 归零，像素级一致），但 tick 频率从 60fps 掉到 ~35fps（受 16ms pump
   与 timer 合并影响），web 侧也跟着从浏览器 rAF 退化。违反 spec §4「web 不能
   退化」。**它只用来证明因果，不作为方案。**
2. **`enableAutoRendering: false` + 自己在变化时调 `f2.render()`。**
   spec §1 里我最初想的就是这条，读完源码否掉：F2 的动画由 timeline 每 tick
   改属性驱动，属性改了只会置上 `renderReasons`，**没有东西会去 `render()`**。
   停掉 autoRendering 就得自己补一个等价循环，等于重写 `Canvas.run()`，还要
   和 f-engine 那几个 `async render()`（`update` / `resize`）抢时序。
   换表比换发动机便宜得多。
3. **在 `packages/fjs-runtime/src/raf.ts` 里给宿主 rAF 加节流 / 合帧。**
   否掉：rAF 的语义就是「下一帧」，运行时不能替页面决定跳帧；而且会误伤正经
   用 rAF 做动画的页面（`example/gomoku`、`example/tetris`）。这是库的调度
   问题，修在库的适配层。
4. **Dart 侧让 `js.raf.request` 不 `ensureVisualUpdate()`。**
   否掉：那样 rAF 驱动的动画在没有别的出帧源时根本不动，是改坏语义。
   （spec §7 里那条 Dart 侧优化是「无 op 就不 notify」，不是这个，且已划到
   另一个 spec。）

## 4. 风险

- **GRACE 选小了 → 动画中途掉到慢轮询**，表现为入场动画走一半顿一下。
  这是最可能翻车的地方，验收第 5 条必须两端各跑一遍人眼核对，不能只看数字。
- **`f2.context.canvas` 不是 F2 的公开契约**（`IContext` 是 `[key: string]: any`）。
  F2 升级改名会静默失去门控 —— 所以必须有 §3 那条 `warn` + 降级，且降级后
  行为等于今天，不会更差。
- **两端对拍**：web 上 `setTimeout` 在后台标签页会被浏览器节流到 1s。那时候
  本来也不该画，但要在 `docs/canvas-compat.md` 里记一句，别让人当成 bug。
- **测量本身有噪声**：模拟器上 push 转场 CPU 单次波动可达 ±15%。验收第 4 条
  要跑 3 次取中位数，别拿单次数字下结论（`docs/performance.md` §「样式基准报
  min，不报单次耗时」是同一类教训）。
  **2026-09-10 实测追加**：噪声比预估的更糟，而且**跨会话不可比**——同一份
  echarts 代码在不同会话测出 480 / 510 / 610 / 640ms（漂移 ~25%）。所以绝对
  毫秒阈值不能当验收条件，只有「同一次会话内的相对口径」和「同一次会话内的
  A/B」能判定。spec §6.4 已按这条重写。
- **探针会污染被测对象**：验收用的计数器包了 `globalThis.requestAnimationFrame`
  和 `setTimeout`，本身有成本。前后必须用同一份探针对比，测完删干净。

## 5. 验证路径

```bash
# 1. 静态
pnpm --filter hello-fjs run typecheck
pnpm test

# 2. 起 dev（已有实例就复用，端口被占会提示换 --port）
cd examples/hello-fjs && pnpm run dev

# 3. Android：进 /example/f2，等入场动画结束后静置 5s，读探针
adb logcat -c
adb logcat -s flutter:V | grep probe
#   期望 raf/s < 5（现状 180），paints/s = 0

# 4. Android：push 转场 CPU，跑 3 次取中位数
#    tap 前后各读一次 /proc/<pid>/stat 的 utime+stime
adb shell pidof com.example.hello_fjs
#   期望 ≤ 600ms / 2s 窗口（现状 840ms，ECharts 对照 510ms）

# 5. web 对拍
cd examples/hello-fjs && pnpm run dev:web:fjs
#   人眼核对：入场动画 60fps、press 出 tooltip、拖动跟手、饼图点选高亮

# 6. 收尾：删掉探针，git status 必须只剩预期的改动
git status --short
```

---

# Plan 第二轮：把重活挪出转场（spec §8）

## 1b. 宪法自查（第二轮）

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | **涉及** | `onPageSettled` 两端都实现：Flutter 在 `router/flutter.ts`（吃 `navSettled` 事件），Web 在 `router/web.ts` + `app/web.ts`（吃 `<Transition>` 的 `onAfterEnter`）。(b) 同理：`lib/src/widgets/canvas.dart` 与 `src/web/components/canvas.ts` 各一份，页面观察到的行为一致 |
| II 边界即契约 | **涉及** | 事件类型表：`native/include/fjs.h` `FJS_EVENT_NAV_SETTLED = 31` + `lib/src/ffi.dart` `FjsEvent.navSettled = 31`。不进 `element.ts` 的 `EventType`——nav 系列都是系统事件，照 10/11 的先例 |
| III 同步单线程零序列化 | 涉及（正向）| 无 payload 的纯信号事件，走既有 `dispatchEvent`，不新开通道、不过 JSON |
| IV 外观照 WeUI | 不涉及 | |
| V 静默失效是 bug | **涉及** | `onPageSettled` 有 1s 兜底：信号没到就强制 settled 并 `warnOnce`。没有这条，一个丢失的事件 = 页面永远白屏，而且没有任何提示 |
| VI 注释记录权衡 | 涉及 | 为什么 (b) 只推迟**首次** resize、为什么兜底是 1s、为什么用 `didPush()` 的 TickerFuture 而不是监听 animation status |
| VII JS 能包就不要下 Dart | **涉及（必须下 Dart）** | 判据在这里明确不成立：「转场结束了没有」是 Flutter Navigator 动画的状态，JS 侧没有任何途径能观察到。引擎里 `_mountPushedRoute` 的 `await endOfFrame` 是同一问题的半步（只等一帧）。所以下 Dart 是必要的，且只下最小的一片：一个无 payload 的信号 |
| VIII 变更落到文档 | 涉及 | `docs/ui-api.md`（`onPageSettled`）、`docs/canvas-compat.md`（首次 `@resize` 的时机变了）、`docs/threading-model.md`（转场期间别干重活）|

## 2b. 涉及的层（第二轮）

| 层 | 文件 | 改什么 |
|----|------|--------|
| 契约 | `packages/flutter_fjs/native/include/fjs.h` | `FJS_EVENT_NAV_SETTLED = 31` |
| 契约 | `packages/flutter_fjs/lib/src/ffi.dart` | `FjsEvent.navSettled = 31` |
| Dart 宿主 | `packages/flutter_fjs/lib/src/fjs_app.dart` | 把 `onSettled` 像既有的 `onDispose` 一样穿过 `_FjsMaterialPage` / `FjsTransitionPage` 到三个 Route 类；`didPush()` 的 `TickerFuture` 完成时回调 |
| Dart 宿主 | `packages/flutter_fjs/lib/src/engine.dart` | `onRouteSettled(key)` → `dispatchEvent(key, FjsEvent.navSettled)` |
| Dart 宿主 | `packages/flutter_fjs/lib/src/widgets/canvas.dart` | (b)：首次 `_reportSize` 等 `ModalRoute.of(context)?.animation` 完成再派 |
| JS runtime | `packages/fjs-runtime/src/router/flutter.ts` | 收 31；`PageEntry.settled` + 待跑回调队列；导出 `onPageSettled`；1s 兜底 + warn |
| JS runtime | `packages/fjs-runtime/src/router/types.ts` | `onPageSettled` 的类型 |
| Web 适配层 | `packages/fjs-runtime/src/router/web.ts` | `onPageSettled` 的 web 实现 |
| Web 适配层 | `packages/fjs-runtime/src/app/web.ts` | `<Transition>` 加 `onAfterEnter`，通知 settled；`transition === false` / `NO_TRANSITION` 立即 settled |
| Web 适配层 | `packages/fjs-runtime/src/web/components/canvas.ts` | (b) 的 web 一半 |
| 文档 | `docs/ui-api.md` / `docs/canvas-compat.md` / `docs/threading-model.md` | 见 1b VIII |

## 3b. 方案与被否掉的备选（第二轮）

**选定**：(a) 新事件 + 页面级 `onPageSettled`；(b) `<canvas>` 首次 `@resize`
推迟到 settled。两条互补——(b) 让现有页面零改动就好，(a) 给 canvas 之外的
重活一个正经钩子。

否掉的：

1. **页面里写 `setTimeout(400)`**（我做因果验证时用的那招）。能跑，但是猜
   一个数字：转场时长两端不同、平台不同（Cupertino ≠ Material）、机器慢了
   还会变。而且每个接重量级库的页面都要自己猜一遍。
2. **只做 (b)，不做 (a)**。canvas 之外的重活（首屏大列表、解析大 JSON）救不到，
   而且「首次 resize 为什么晚了」变成一个查不到出处的隐晦行为。
3. **只做 (a)，不做 (b)**。得改每一个图表页的源码；spec §3 明说 `f2.vue`
   一行不改。
4. **监听 route 的 `animation.status == completed` 而不是 `didPush()` 的
   TickerFuture**。等价但更啰嗦，还要自己管 listener 的摘除；`didPush()` 返回的
   TickerFuture 在动画被打断（转场中途又 pop）时也会结算，正是我们要的语义。
5. **把 `navMount` 直接延后到转场结束**（不新增事件）。看着省一个事件号，
   实际是把「页面挂载」和「页面可以干重活」两件事捆死：转场期间页面连骨架都
   不渲染，白屏时间反而变长。

## 4b. 风险（第二轮）

- **兜底 1s 会不会掩盖真 bug**：会。所以兜底必须 `warnOnce` 且写清楚
  「这说明 navSettled 没到，是 bug 不是设计」。
- **(b) 改的是既有语义**：`@resize` 的首次触发时机变晚。已经依赖它「尽早」
  的页面会看到图表晚出现约一个转场时长。`docs/canvas-compat.md` 要写明。
- **tab 切换 / 初始页不能被漏掉**：这两种没有 Navigator push 动画，如果不
  显式立即 settled，页面会一直等到 1s 兜底才建图——比现在还糟。
- **Dart 侧改动要重编 App**：模拟器上跑的是 debug 包，JS 热重载覆盖不到
  Dart。验收前必须 `fjs run android` 重编一次，否则测的是旧宿主。
- **`flutter test` 必须先编 native**，否则整文件静默跳过（AGENTS.md §3）。

## 5b. 验证路径（第二轮）

```bash
pnpm --filter hello-fjs run typecheck && pnpm test
cd packages/flutter_fjs/native && cmake -B build-native -DFJS_BUILD_TESTS=ON && cmake --build build-native -j
cd packages/flutter_fjs && flutter test          # 确认输出是用例数，不是 No tests ran
cd examples/hello-fjs && pnpm run run:android    # 重编，Dart 改动才生效
# 然后按 spec §8 验收第 2 条量帧间隔，跑 3 次
```
