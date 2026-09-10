# Spec: 重活不再压在路由转场上（F2 图表页卡顿）

- **ID**: 027-chart-raf-frame-pin
- **状态**: in-progress（转场停顿已修，见 §8/§8b；只差 §6.5 的 web 一半，见 tasks T060）
- **日期**: 2026-09-10

## 1. 要解决什么

`/example/f2` 页在 App 上会卡路由转场动画；同样用 `<canvas>` 回执的
`/example/echarts` 页不会。

> **这一节记录了一次归因错误，保留原样是故意的**：第一轮查到的现象是真的，
> 但它不是卡顿的原因。真正的原因和修法在 §6c / §8。

### 第一轮（错的那条线）：空转的 rAF

2026-09-10 在 Android 模拟器实测，停在页面上什么都不动：

```
ECharts 页：raf/s=0    timer/s=12   paints/s=1    cmds/s=88
F2 页：    raf/s=180   timer/s=0    paints/s=0    cmds/s=0    ← 一直这样
```

F2 一笔都没画，却每秒 180 次向宿主要帧回调（3 张图 × 60fps）。机制是清楚的：

- **zrender 走 `setTimeout`**。它在模块加载时按 `env.hasGlobalWindow` 把 rAF
  定死（`zrender/lib/animation/requestAnimationFrame.js`），QuickJS 里没有
  `window`，于是退化成 `setTimeout(f, 16)`，跑在 `Timer.periodic(16ms)` 的 pump
  上——**在 Flutter 帧管线之外**。
- **g-lite 的 `Canvas.run()` 是无条件自续的 tick**
  （`tick(){ render(); frameId = raf(tick) }`），而适配层把宿主的
  `requestAnimationFrame` 直接交给了它。fjs 的 rAF 是宿主帧回调
  （`scheduleFrameCallback` + **`ensureVisualUpdate()`**），申请一次就强制
  Flutter 出一帧。

于是每张图都是一个「每帧强制出帧 + 一次 JS↔Dart 往返 + 一次整树 notify」的
循环，三张图三份，全落在 UI 线程上。

**但这不是卡顿的原因。** 当时拿「2 秒窗口的进程 CPU」当验收指标，加了帧时钟
门控，CPU 920 → 750ms（同会话 A/B，−18%），判过 —— 用户反馈仍然卡。改量帧
间隔才看清真凶（§6c）。

**门控最后撤掉了**（用户 2026-09-10 决定）：实测收益只有空闲时约 2% CPU
（F2 页 470ms/5s vs 普通列表页基线 360ms/5s），没有任何用户可见的现象能归到
它头上，却要给「绕过适配层改场景」引入最多 200ms 的延迟。现象本身记进了
`docs/canvas-compat.md` §12.3 和 `docs/roadmap.md`，标为已知未修。

顺带记一条**待查、不在本 spec 范围**的观察：静止在普通列表页时 Flutter 仍在
稳定出 ~60fps（SurfaceFlinger 实测 123 帧 / 2s），有别的东西一直钉着帧循环。
它也是「那 2% 到底值不值得修」说不清楚的原因之一。

## 2. 不做什么（Non-goals）

- 不改 op 协议、显示列表、`context-2d.ts` 的任何编码 —— 已验证不是瓶颈。
- **不修 §1 那条空转 rAF**（做过又撤了，理由同上）。
- 不动 `echarts/adapter.ts`：它已经在正确的时钟上。
- 不查「静止页面也在 60fps 出帧」那条（§1 末尾），另开 spec。
- 不做 Dart 侧「无 op 就不 notify」那条通用优化（§7），另开 spec。
- 不为「图表库适配」抽一层通用框架。`f2/adapter.ts` 仍然是页面侧的示例代码。
- 不改 F2 首帧渲染本身的成本（约 70ms/张）。那是 F2 的账，这里只解决
  「它落在哪一帧」。
- 不改 `<canvas>` 组件的 props / 事件，页面源码一行不动。
- 不追求「F2 的每一帧都比现在快」。目标是**空闲时不要占帧**，动画期间
  该多快还多快。

## 3. 用户可见的行为

图表页照旧在 `@resize` 里建图，只多一个属性（`defer-resize`，§8 (b)）：

```vue
<canvas
  defer-resize
  ref="lineEl"
  class="chart"
  @resize="mountLine"
  @touchstart="(e: FjsTouchEvent) => onTouch('line', 'start', e)"
  @touchmove="(e: FjsTouchEvent) => onTouch('line', 'move', e)"
  @touchend="(e: FjsTouchEvent) => onTouch('line', 'end', e)"
/>
```

改完之后：

1. 进 / 出 `/example/f2` 的转场动画和 `/example/echarts` 一样顺，不掉帧。
2. 入场动画照常（折线 ~400ms 从左往右画完），tooltip 的 press / pan /
   pressend、饼图 `selection` 点选高亮、`resize` 重排，行为全部不变。
3. 图表比以前晚出现约一个转场时长（Android 默认约 300ms）——这是 (b) 的代价，
   所以它是开关而不是默认行为。

> **原本还有一条「停在页面上不操作时，适配层不再持续申请宿主帧回调」**，
> 对应 §1 第一轮那条线。门控做过又撤了（§1），所以这条不再是本 spec 的目标；
> 现象记在 `docs/canvas-compat.md` §12.3，标为已知未修。

## 4. 两端约定（宪法 I）

第一轮这一节写的是帧时钟的两端差异；门控撤掉后，本 spec 真正的两端约定在
**§8「两端约定」**（`onPageSettled` 与 `defer-resize`）。这里只保留那条仍然
成立的背景事实：

| | Flutter | Web |
|---|---|---|
| 帧时钟 | 宿主帧回调（`scheduleFrameCallback` + `ensureVisualUpdate`），**申请一次就强制出一帧** | 浏览器 rAF，页面不动时浏览器自己不出帧 |
| 已知差异 | web 上「永续 tick」几乎不要钱，App 上每 tick 都是一帧。F2 示例目前就是永续 tick（§1，已知未修）| 同左 |

## 5. 契约变更（宪法 II）

第一轮：都不涉及。**第二轮涉及事件类型表**，见 §8「契约变更」
（`FJS_EVENT_NAV_SETTLED = 31`，`fjs.h` + `ffi.dart`）。

## 6. 验收标准

1. `pnpm --filter hello-fjs run typecheck` 通过。
2. `pnpm test` 不回退。
3. **转场不掉帧**（这是唯一能判「修好了没有」的指标）：从示例列表 tap 进
   `/example/f2`，量**真实呈现帧的间隔**——`dumpsys SurfaceFlinger --latency`
   取相邻帧差，跑 3 次，**看原始序列不看均值**。要求：转场窗口内没有孤立的
   大停顿（现状是每次都在第 2 帧停 ~205ms），序列与同一次会话里的
   `/example/echarts`、`/example/gltf-viewer` 同形。

   > **2026-09-10 两次校准**：
   > 1. 这条最初是拿「`tap → +2s` 窗口的进程 CPU」当指标的，判过了，用户仍然
   >    卡——一个 200ms 的停顿摊进 2 秒 CPU 里只占 10%，均值盖得住（§6c）。
   >    **CPU 不能判流畅度，只能量帧间隔。**
   > 2. 帧间隔的绝对值**跨时段也不可比**：同一份 ECharts 代码不同时段测出
   >    16-17ms 和 30-60ms（期间跑过 `flutter build apk`，还有 iOS 模拟器在吃
   >    40% CPU）。所以只有**同一次、同样负载下**的对照和 A/B 能判定。
4. **动画没被改坏**：Android 与 web 上各跑一遍，人眼核对 §3 第 2 条列的四项
   （入场动画、press tooltip、pan 跟手、饼图点选），并各留一张截图。
5. **图表照常出现**，只是晚一个转场时长。
6. 文档：`docs/canvas-compat.md`（`defer-resize` 的语义 + §12.3 那条已知未修）、
   `docs/threading-model.md`（rAF 是宿主帧回调 / 转场期间别干重活）、
   `docs/ui-api.md`（`onPageSettled` + `defer-resize`）、`docs/performance.md`
   （两条量法教训）、`docs/roadmap.md`。

## 6b. 验收结果（2026-09-10 实测）

| # | 条目 | 结果 |
|---|------|------|
| 1 | `pnpm --filter hello-fjs run typecheck` | ✅ 通过 |
| 2 | `pnpm test` 不回退 | ✅ 433 passed（fjs 94 / fjs-runtime 275 / fjs-webview 36 / fjs-webgl 28）|
| 3 | ~~空闲 rAF < 5 次/秒~~ | **作废**：门控已撤（§1）。当时实测确实做到了 0，但这条本来就不该是本 spec 的验收项 |
| 4 | ~~转场不再更贵（CPU）~~ | **作废**：CPU 是错的指标，见 §6c。判定改到新 §6.3 的帧间隔 |
| 5 | 动画没被改坏 | **Android ✅ 四项全过**（入场动画 / press tooltip / 拖动跟手 / 饼图点选，截图见 tasks T021）；**Web 部分通过**——渲染与入场动画核对过，帧率数字本环境测不了，见下 |
| 6 | `docs/canvas-compat.md` §12.3 改写 | ✅ |
| 7 | `docs/threading-model.md` 新增 rAF 一节 | ✅ |
| 8 | `docs/performance.md` 记实测 | ✅ |

**唯一未结项**：§6.5 的 web 一半。应用内浏览器面板的
`document.visibilityState` 恒为 `hidden`，浏览器把 rAF 挂起，任何 fps /
重绘速率都不可信；用户的 Chrome 扩展当时未连接，换不了真浏览器。
收口步骤写在 tasks.md 的 T060。

**按构造分析**（不能替代测量，但说明风险方向）：门控只会在「300ms 没画过
且没有动画在跑」时降级，动画期间走的是浏览器原生 rAF，和改动前同一条路；
`attach` 失败时整体不门控，等同改动前。所以 web 侧不存在「比改动前更慢」
的路径，只可能是「降级判据在 web 上过于激进」——这正是 T060 要看的。

## 6c. 复测：转场仍然卡（2026-09-10 晚，用户指出）

§6b 判「转场不再更贵 ✅」用的是**进程 CPU** 这个代理指标。用户反馈仍然卡，
改测**真实呈现帧的间隔**（SurfaceFlinger `--latency`），结论是 §3.1
「进/出 `/example/f2` 的转场动画和 `/example/echarts` 一样顺」**没有达成**。

tap 之后 2.5s 内的帧间隔（ms），三次：

```
F2:      34 211 14 24 14 17 16 18 15 17 16 18 15 17 17 16 ...
F2:      13 204 10 21 17 17 15 16 17 17 16 17 18 16 16 17 ...
F2:      28 203 10 21 17 16 17 16 17 16 17 16 17 17 16 16 ...
ECharts: 18  27 18 15 16 19 15 17 17 18 16 15 18 17 18 20 ...
```

**每次 push 都在第 2 帧卡死约 200ms（211 / 204 / 203），之后一路 16-17ms。**
不是普遍变慢，是一个固定的启动停顿——正好压在转场动画刚起步的那十几帧上。

定位（在适配层打时间戳）：

```
[t] ctor=2ms renderCall=0ms     ← 12:07:33.230  第 1 张
[t] ctor=4ms renderCall=0ms     ← 12:07:33.306  第 2 张（+76ms）
[t] ctor=4ms renderCall=0ms     ← 12:07:33.380  第 3 张（+150ms）
[t] first rerender at +210ms    ← 第 1 张第一次真正出图
```

`new Canvas()` 本身只要 2-4ms，`f2.render()` 是 async 当场返回 0ms——**贵的是
它 await 之后那一段**：F2 组件树构建 + G 场景图 + 首次布局，每张约 70ms，
三张串起来约 210ms，全部落在 pump 里、UI 线程上。ECharts 的
`init + setOption` 同口径只要 19 / 10 / 9ms，所以它没这个坑。

**验证**：把 `f2.vue` 里三个 `mount*` 全部 `setTimeout(..., 400)` 延后，转场
前 25 帧变成干净的 16-17ms，那个 200ms 停顿原样搬到了 +420ms（转场结束之后）：

```
16 10 16 17 16 16 17 17 16 17 17 16 17 16 17 17 17 17 17 17 16 17 17 17 17 208 11 21 17 ...
                                                                            ↑ 转场早已结束
```

因果确定：**卡的是 F2 首帧渲染压在转场上，和帧时钟门控是两件事。**
门控修的是空闲期钉帧（`raf/s` 180 → 0，那个问题真实存在且已解决），
但它管不着首帧这 210ms。

### 教训

§6.4 当初拿 CPU 当验收指标是错的。CPU 总量下降 18% 与「看得见的卡顿消失」
不是一回事——一个 200ms 的停顿在 2s 的 CPU 总量里只占 10%，但用户看到的就是
它。**验收路由动画流畅度必须直接量帧间隔**（`dumpsys SurfaceFlinger --latency`
+ 算相邻帧差），量法已写进 `docs/performance.md`。

### 未做：怎么修

页面里写死 `setTimeout(400)` 是能跑，但那是猜一个数字，且每个接重量级库的
页面都要自己猜一遍。正确的做法需要一个「路由转场已结束」的信号，而**这个信号
JS 侧拿不到**——转场是 Flutter Navigator 的动画，JS 没有可见性（宪法 VII 的
「必须下 Dart」判据在这里成立）。

引擎里已经有半步了：`_mountPushedRoute` 会 `await endOfFrame` 再挂载，注释写
的是「让 Navigator 先画出转场再让 JS mount」——但它只等**一帧**，够转场
「开始」，不够转场「结束」。

留给下一个 spec，选项见 tasks T070。

## 8. 第二轮：把重活挪出转场（2026-09-10 晚，用户指定做 (a)+(b)）

§6c 定位到的停顿不是帧时钟能修的：F2 首帧渲染约 70ms/张 × 3 张 ≈ 210ms，
正好压在转场刚起步的十几帧上。要修就得让这段活**等转场结束再干**，而
「转场结束了没有」这件事 **JS 侧看不见**——它是 Flutter Navigator 的动画。

两条一起做（用户 2026-09-10 决定，不另开 spec）：

### (a) 通用信号：`onPageSettled`

新增一个页面级 API：**这一页的路由转场跑完了**。

```ts
import { onPageSettled } from 'fjs/router';

// 页面里：重活等转场结束再做
onPageSettled(() => {
  buildTheExpensiveThing();
});
```

语义：

* 一次性。已经 settled 的页面上调用它，回调在**下一个微任务**里跑（不同步
  回调，免得调用方拿不到自己的初始化顺序）。
* 没有转场的页面（初始页、tab 切换、`meta.transition: false`）立即算 settled。
* 页面卸载后不再触发。
* **兜底**：转场信号 1s 内没到，强制 settled 并 `warnOnce` 一次。宁可早跑一点，
  也不能让页面永远等不到而白屏（宪法 V）。

### (b) `<canvas defer-resize>`：把首次 `@resize` 推迟到转场之后

`<canvas>` 新增一个布尔属性 `defer-resize`，**默认关**。开了之后，这个 canvas
拿到尺寸的**第一次** `@resize` 等这一页的转场结束再派；第二次起（真正的尺寸
变化）无论开没开都立即派。

```vue
<canvas defer-resize class="chart" @resize="mountChart" />
```

理由：`@resize` 是图表页的建图入口（spec 019 就是这么设计的），而建图天然是
重活。但**不能默认开**——等待的代价是一个转场时长的空白画布，对一个便宜的
canvas（迷你折线、签名板）这是亏的。所以做成开关，只有首帧真的贵的页面才开。

> **用户 2026-09-10 定的**：最初的设计是「默认推迟所有 canvas 的首次
> `@resize`」。改成开关，示例里只有 `/example/f2` 和三个 webgl / three.js 页
> 打开。

代价是语义仍然隐晦一点，所以 (a) 仍然要有：canvas 之外的重活（大列表首屏、
解析一坨 JSON）得有个能自己订阅的钩子。

### 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 「转场结束」怎么知道 | 路由 `didPush()` 返回的 `TickerFuture` 完成 | `<Transition>` 的 `onAfterEnter`（`app/web.ts` 里已有 `onAfterLeave` 的先例）|
| 怎么告诉 JS | 新事件 `navSettled = 31`，`dispatchEvent(key, 31)` | 直接在 JS 里，不过事件 |
| 无转场的情况 | `transition: 'none'` / 初始页 / tab replace → 立即 | `transition === false` / `NO_TRANSITION` → 立即 |
| (b) 落在哪 | `widgets/canvas.dart`：`deferResize` 为真时，首次 `_reportSize` 等 `ModalRoute.of(context)?.animation` 完成 | `web/components/canvas.ts`：同一个开关，等本页 `<Transition>` 的 afterEnter |
| (b) 的属性名 | `defer-resize`（模板）→ `deferResize`（过桥，renderer 会 camelize）| 同左 |

### 契约变更（宪法 II）

- [x] **事件类型**：`native/include/fjs.h` 的 `FJS_EVENT_NAV_SETTLED = 31`
      + `lib/src/ffi.dart` 的 `FjsEvent.navSettled = 31`。
      **不进 `element.ts` 的 `EventType`**：nav 系列（10 navMount / 11 navPop）
      都是 `registerSystemHandler` 的系统事件，不是模板上写得出的 `@xxx`，
      照既有先例走。
- [ ] UI op 协议 —— 不涉及
- [ ] natives 表 —— 不涉及

### 验收（第二轮）

1. `pnpm --filter hello-fjs run typecheck` + `pnpm test` + `flutter test` 全过。
2. **帧间隔**（`dumpsys SurfaceFlinger --latency`，量法见 §6c / performance.md）：
   push 进 `/example/f2`，转场那 2.5s 内**没有 > 33ms 的帧间隔**，
   序列和 `/example/echarts` 同形。跑 3 次。
3. `f2.vue` / `echarts.vue` **源码一行不改**，图表照常出现（只是晚一个转场时长）。
4. §3 的四项行为（入场动画 / press tooltip / 拖动跟手 / 饼图点选）两端不变。
5. `onPageSettled` 两端都有，且 web 上无转场时也会触发（tab 页、
   `transition: false`）。
6. 兜底路径可验证：Dart 侧不发 `navSettled` 时页面仍然会在 1s 后 settled 并
   告警一次。
7. 文档：`docs/ui-api.md`（新 API）、`docs/canvas-compat.md`（首次 resize 的
   时机）、`docs/threading-model.md`（转场期间不要干重活）。

## 8b. 第二轮验收结果（2026-09-10 晚）

| # | 条目 | 结果 |
|---|------|------|
| 1 | typecheck + `pnpm test` + `flutter test` | ✅ JS 439 passed（fjs 94 / runtime 281 / webview 36 / webgl 28）；`flutter test` **267 passed**（不是 `No tests ran`）；`dart analyze` 改动文件无新增问题 |
| 2 | 帧间隔：转场窗口干净 | ✅ 见下 |
| 3 | 页面源码零改动 | ⚠️ **改了**：`defer-resize` 是开关，要页面显式打开。`f2.vue` 三个 canvas + `webgl.vue` / `three-gltf.vue` / `gltf-viewer.vue` 各一个，共 +6 行。这是用户 2026-09-10 明确要求的取舍（默认不延迟）|
| 4 | 四项行为不变 | ✅ Android 复核过（入场动画 / press tooltip「三: 90」跟手 / 饼图点选淡化）|
| 5 | `onPageSettled` 两端都有 | ✅ 实现两端齐；单测覆盖一次性 / 异步 / 卸载丢弃 / 兜底 |
| 6 | 兜底路径 | ✅ 1s 未收到 `navSettled` 则放行并 `warnOnce`（`SETTLE_FALLBACK_MS`）|
| 7 | 文档 | ✅ ui-api / canvas-compat / threading-model / roadmap |

### 帧间隔：两组数据

**空载时（12:30，机器安静）**——`defer-resize` 开，跑 3 次，转场窗口（前 20 帧）
最大间隔：

| 页面 | 转场窗口 max | 对照 |
|---|---|---|
| F2（开） | 39 / 37 / 32 ms | — |
| ECharts（未开） | 46 / 39 ms | 基线噪声 |
| gltf 查看器 | 32 / 33 ms | 基线噪声 |

那个 205ms 停顿整个搬到了 +400ms（转场早已结束）。**F2 与两个对照页在转场
窗口内已经无法区分**。

**满载时（12:42，iOS 模拟器占 40% CPU、load 4.5）**——同会话 A/B，同样负载：

| | 卡顿前的干净帧数 | 卡顿值 |
|---|---|---|
| `defer-resize` **关** | 1 / 1 / 1 | 1317 / 1229 / 1204 ms |
| `defer-resize` **开** | **12 / 16 / 17** | 1076 / 1411 / 1292 ms |

机器满载时 F2 首帧从 210ms 涨到 ~1.2s，比整个转场还长，所以开了之后停顿仍会
盖住转场的尾巴——但**开头 12-17 帧是干净的，关的时候第 2 帧就死了**。机制
按设计工作；能保护多少取决于「转场时长 vs 首帧耗时」的比值。

### 教训（第二次）

第一轮拿 CPU 当指标翻过一次车（§6c），这轮又踩了**跨时段不可比**：同一份
ECharts 代码在 12:30 测出 16-17ms，12:42 测出 30-60ms，因为期间跑了两次
`flutter build apk`、`pnpm test`，还有个 iOS 模拟器在吃 40% CPU。
**只有同一次、同样负载下的 A/B 能下结论**——这条已经写进
`docs/performance.md`，这次是第二个例证。

## 7. 待澄清

已拍板（2026-09-10，用户确认走主线）：

- [x] **「无 op 就不 notify」不在本 spec 内。** 现在 `dispatchEvent` 末尾无条件
      `_scheduleUiNotify()` → 整树 `notifyListeners()`，一个什么都没产出的 rAF
      回调也会付这份钱。这是一条**通用**收益（所有 rAF 驱动的库都受益），但它
      动 `engine.dart`，要重编 Flutter，与本 spec「只改 JS 侧适配层」的范围不
      同频。→ 另开 spec。
- [x] **不加运行时告警。** 「某个 canvas 每帧要 rAF 却零绘制命令就 warnOnce」
      这条留着不做：判据要在 `raf.ts` 或 surface 层记账，且会误报合法的空闲
      轮询动画。改用文档承担（§6.6 / §6.7）—— 下一个人接别的库时，
      `threading-model.md` 那节就是他要读的东西。
- [x] **「静止页面也在 60fps 出帧」稍后再开 spec。** 与本条独立，但气味相同
      （怀疑同样是有人在无条件 `ensureVisualUpdate`），大概率和上面第一条是
      同一个 spec。

无剩余待澄清项。
