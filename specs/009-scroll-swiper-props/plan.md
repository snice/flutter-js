# Plan: scroll-view / swiper 属性补全

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | **是** | 每个属性两端都做。Flutter：`lib/src/node/node_adapters.dart` 的两个 adapter 拆成 `lib/src/widgets/scroll_view.dart`（新）与 `lib/src/widgets/swiper.dart`（新）；Web：`src/web/components/basic.ts` 的 `FjsScrollView` 与 `src/web/components/swiper.ts`，指示点几何进 `base-css.ts`。阈值判断与 `@scroll` 的字段名两端共用一份定义（§3.2）。 |
| II 边界即契约 | **是（事件类型）** | 新增 24 `onScrollToUpper` / 25 `onScrollToLower`，三处同步：`fjs-runtime/src/ui/element.ts`、`flutter_fjs/lib/src/ffi.dart`、`flutter_fjs/native/include/fjs.h`。`scroll`(12) 号不变但**载荷改成 JSON 串**（spec Q3），载荷仍是标量字符串。op 协议、natives 表不动。 |
| III 同步单线程零序列化 | 否 | 不新增异步通道。`@scroll` 沿用现有的「一帧一次」合并（`list_view.dart` 的 postFrame 队列），不会一帧多发。 |
| IV 外观照 WeUI | **是（指示点）** | 指示点取 WeUI/小程序的默认值：直径 8、间距 4、底部 16、未选中 `rgba(0,0,0,0.3)`、选中 `#000000`（`indicator-color` / `indicator-active-color` 可覆盖）。两端同一组数值。 |
| V 静默失效是 bug | **是** | 三处 `warnOnce`：① `scroll-into-view` 找不到目标 id；② `scroll-x` 与 `scroll-y` 同时为真（小程序未定义，fjs 取纵向并出声）；③ `swiper` 的 `current` 越界（钳到末页并告警）。两端都要有。 |
| VI 注释记录权衡 | **是** | 至少四处：阈值为什么要「离开再回来才重发」（§3.3）、`scroll-top` 为什么不是每帧强制回写（§3.4）、指示点为什么在 widget 层（§3.6）、`circular` 两端实现不同但语义相同（§3.5）。 |
| VII JS 能包就不要下 Dart | **是（逐条判过）** | 落 Dart 的都要平台能力：滚动位置与动画是 `ScrollController` 的，翻页是 `PageController` 的，`@scroll` 的六个字段要 `ScrollMetrics`（内容总高、视口高），JS 侧拿不到。**指示点**看着像纯展示，但 `swiper` 的直接子节点就是「页」——JS 侧塞一个绝对定位的圆点容器会多出一页，除非把 swiper 整个改成组件包原生 pager，那是重构不是补属性（spec §4 已记）。**`swiper-item` 不下 Dart**：它没有自己的行为，注册成普通容器 adapter 即可。 |
| VIII 变更落到文档 | **是** | `docs/ui-api.md`（两个标签的属性/事件表、`@scroll` 载荷变更、`swiper-item` 与小程序的宽松差异）、`docs/web.md`（回弹与 `circular` 的实现差异）、`docs/roadmap.md`（打勾 + **breaking change 单独一条**）。 |

无破例项。

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| JS runtime | `packages/fjs-runtime/src/ui/element.ts` | `EventType` +`onScrollToUpper: 24` / `onScrollToLower: 25` |
| | `packages/fjs-runtime/src/tags.json` | +`swiper-item` |
| | `packages/fjs-runtime/src/scroll/metrics.ts`（新）| 两端共用的纯函数：`@scroll` 载荷的字段顺序与序列化、上下阈值的「进入/离开」状态机、`circular` 的索引取模。**不依赖 Vue / DOM，好测** |
| | `packages/fjs-runtime/src/components/list-view.ts` | `consumeScroll` 现在读的是数字串（第 71-85 行），改成读 JSON 的 `scrollTop`；它自己 emit 的 `scroll` 也换成新载荷 |
| | `packages/fjs-runtime/src/vue-global.d.ts` | `FjsScrollViewProps`（新）、`FjsSwiperProps` 扩写、`swiper-item`，两处注册 |
| Web 适配层 | `packages/fjs-runtime/src/web/components/basic.ts` | `FjsScrollView`：scroll-x/y、scroll-top/left（+动画）、scroll-into-view、`@scroll`、两个阈值事件 |
| | `packages/fjs-runtime/src/web/components/swiper.ts` | current / autoplay / interval / duration / circular / vertical / 指示点 |
| | `packages/fjs-runtime/src/web/components/index.ts` | 注册 `swiper-item` |
| | `packages/fjs-runtime/src/web/components/list-view.ts` | 跟着新载荷改（第 94 行附近取 scrollTop/scrollLeft）|
| | `packages/fjs-runtime/src/web/base-css.ts` | 指示点几何、`swiper-item` 的默认盒模型 |
| Dart 宿主 | `packages/flutter_fjs/lib/src/widgets/scroll_view.dart`（新）| 从 `_ScrollViewNodeAdapter` 搬出来并补属性：`ScrollController`、`NotificationListener`、阈值、`scroll-into-view` |
| | `packages/flutter_fjs/lib/src/widgets/swiper.dart`（新）| 从 `_SwiperNodeAdapter` 搬出来：`PageController`、autoplay 定时器、circular、vertical、指示点 |
| | `packages/flutter_fjs/lib/src/widgets/list_view.dart` | `_onScroll` 现在发 `toStringAsFixed(1)`（第 50 行），改成发同一份 JSON |
| | `packages/flutter_fjs/lib/src/render/style.dart` | `scrollDirection` 增加 prop 优先的判断（`scroll-x` / `scroll-y` 先于样式键 `direction`）|
| | `packages/flutter_fjs/lib/src/node/node_adapters.dart` | 两个 adapter 改成薄封装 + 注册 `swiper-item` |
| | `packages/flutter_fjs/lib/src/ffi.dart` | `FjsEvent` +2 |
| C++ 引擎 | `packages/flutter_fjs/native/include/fjs.h` | 枚举注释 +24/25（不需重编）|
| 迁移 | `packages/fjs-runtime/test/web-list-view.test.ts`、`packages/flutter_fjs/test/nav_router_test.dart` | 现存仅有的两个 `@scroll` 消费者，跟着改断言 |
| 示例 | `examples/hello-fjs/src/pages/comp/scroll-view.vue`、`comp/swiper.vue` | 扩成能演示新属性 |
| 测试 | `packages/fjs-runtime/test/scroll-metrics.test.ts`（新）| 阈值状态机、载荷字段、取模 |
| | `packages/fjs-runtime/test/web-scroll-swiper.test.ts`（新）| web 侧行为 |
| | `packages/flutter_fjs/test/scroll_view_props_test.dart`、`swiper_props_test.dart`（新）| Dart 侧对拍 |
| 文档 | `docs/ui-api.md` / `docs/web.md` / `docs/roadmap.md` | 见 §1 VIII |

## 3. 方案

### 3.1 顺序

1. 契约层：事件号、`tags.json`、d.ts
2. `scroll/metrics.ts` + 单测（阈值状态机与载荷格式先钉死，两端都照它写）
3. **载荷迁移**：`list_view.dart` / `components/list-view.ts` /
   `web/components/list-view.ts` 三处一起改，连同两个测试消费者——这一步单独
   成一段，跑绿了再往下（spec Q3 是 breaking change，不能和新功能混在一起排查）
4. scroll-view 的属性：Dart → web → 对齐
5. swiper 的属性：Dart → web → 对齐
6. 示例页 + 两端对拍 + 文档

### 3.2 两端共用一份「滚动语义」

`scroll/metrics.ts` 里放三样纯函数，两端各自调用（Dart 侧照抄同名逻辑并在
注释里指回这个文件——它是规格，不是运行时依赖）：

```ts
scrollPayload({scrollTop, scrollLeft, scrollHeight, scrollWidth, deltaX, deltaY})
  -> string        // 字段顺序固定，两端 JSON 逐字节相同
edgeState(prev, {offset, viewport, content, upper, lower}) -> 'upper'|'lower'|null
wrapIndex(i, count, circular) -> number
```

`edgeState` 是个**状态机**而不是一次判断：传入上一次的状态，只有从「不在阈值
区」进入才返回边名，一直待在区里返回 null。没有它，一次触底会在每个滚动帧上
各发一条 —— 小程序自己都在文档里提这个坑。

### 3.3 `@scroll` 的载荷与频率

- 字段：`scrollTop / scrollLeft / scrollHeight / scrollWidth / deltaX / deltaY`，
  和小程序同名。`delta*` 是与上一次派发之间的差值（不是每帧差值）。
- 频率：沿用 `list_view.dart` 已有的一帧一次合并（postFrame 队列），web 侧沿用
  `web/components/list-view.ts` 的同款队列。两端都不会一帧多发。

### 3.4 `scroll-top` / `scroll-left` 是「受控但不粘手」

照 `input` 的 `value` 那套（`widgets/input.dart` 的 `_lastPropValue`）：记住上
一次从 JS 收到的值，只有当它**变化**时才 `jumpTo` / `animateTo`。否则用户手指
滚动会被每帧回写的旧值拽回去。用户自己滚出的位置不写回 prop——那是页面的事。

### 3.5 `circular` 两端实现不同、语义相同

- Flutter：`PageView.builder` 不给 `itemCount`，用 `wrapIndex` 取模，控制器停在
  一个远离两端的初始页。
- Web：轨道两端各复制一页，翻到复制页后**无动画**跳回真页（CSS 轮播的老办法）。

两边都保证：`@change` 派发的永远是**真实索引**（0..count-1），页面看不到复制页
或大页码。这条写进注释与 `docs/web.md`。

### 3.6 指示点

widget 层画（理由见 §1 VII）。两端同一组数值：直径 8、间距 4、距底 16、
未选中 `rgba(0,0,0,0.3)`、选中 `#000000`。`vertical` 时移到右侧竖排。

### 3.7 被否掉的备选

- **`scroll-view` 用 `NestedScrollView` / 自定义 physics 来做触底**：Flutter 的
  `ScrollNotification` 已经带了 `metrics`，够用；换 physics 会连带影响
  `list-view` 与页面根滚动的手感。
- **`@scroll` 保持数字串、另开一个 `onScrollDetail`**：两个事件描述同一件事，
  页面要挑一个用；而且新事件号也要过契约表。不如一次改干净（spec Q3）。
- **指示点做成 JS 组件**：见 §1 VII —— 会多出一页。
- **autoplay 用 Flutter 的 `AnimatedList`/`Ticker` 自绘**：`PageController` +
  `Timer` 已经够，且能天然复用 `duration`。

### 3.8 实施修正：`scroll-into-view` 怎么找到目标节点

plan 只写了「postFrame 里量位置」，没说**怎么拿到目标节点的 BuildContext**——
镜像树里的 `MirrorNode` 没有这个东西，`_nodeView` 给每个节点的 key 是便宜的
`ValueKey<int>`。

改法：**只有带 `id` 属性的节点**改发 `GlobalKey`（`MirrorTree.globalKeyFor(id)`
按需创建、随节点销毁清理），其余节点一律照旧。`scroll-into-view` 于是能用
`key.currentContext` 拿到目标的 RenderBox，按本 scroller 的坐标系换算偏移。

代价与边界：GlobalKey 比 ValueKey 贵（要进全局注册表），所以严格限定在「页面
自己写了 id」的节点上——那本来就是少数，且 `id` 在 fjs 里的用途正是「被别人
指名道姓」（`<label for>` 也是靠它）。

**否掉的备选**：`Scrollable.ensureVisible`。它自带对齐规则与动画曲线，web 侧
要复刻就得连它的 `alignment` 语义一起抄；自己算偏移两端才好对齐（spec §4 也是
这么写的）。

## 4. 风险

1. **breaking change 的波及面**：`@scroll` 现在只有两个测试消费者（已 grep
   确认，demo/examples 的页面都没用），但外部使用者会碰到。缓解：迁移单列一步
   （§3.1 第 3 步），docs 与 roadmap 都写明改法。
2. **`list-view` 的自驱预取**：`components/list-view.ts` 的 `consumeScroll` 拿
   偏移决定何时追加下一批（第 71-85 行）。载荷换形状时这里必须跟着改，否则
   长列表会**停止加载但不报错** —— 典型的静默失效，测试要覆盖「滚到底仍能追加」。
3. **阈值事件重复派**：见 §3.2，两端都必须走状态机；测试直接数事件条数。
4. **`current` 与用户滑动打架**：和 `scroll-top` 同一类问题（§3.4），只有 prop
   变化才 `animateToPage`；派发 `@change` 时不回写自己的 `current`。
5. **`circular` 的索引换算**：Flutter 取模、web 复制页，两边都容易在边界上错一
   位。`wrapIndex` 的单测要覆盖 -1 / count / 2*count。
6. **`scroll-into-view` 的时机**：目标节点可能还没布局。Flutter 侧要在
   postFrame 里量；找不到就告警而不是静默不动。

## 5. 验证路径

```bash
pnpm run typecheck
pnpm test
pnpm --filter hello-fjs run typecheck

cd packages/flutter_fjs/native && cmake -B build-native -DFJS_BUILD_TESTS=ON && cmake --build build-native -j
cd packages/flutter_fjs && flutter test

pnpm --filter hello-fjs run dev:web     # /comp/scroll-view 与 /comp/swiper
pnpm --filter hello-fjs run run:ios     # 同上；Android 不测
```

对拍清单：触底只派一次且离开再回来才重派、`scroll-into-view` 落到同一条、
`scroll-top` 不打断手指滚动、长列表滚到底仍在追加（风险 2）、自动播间隔与
按住暂停、`circular` 末页翻首页时 `@change` 给的是 0、指示点位置与配色。
