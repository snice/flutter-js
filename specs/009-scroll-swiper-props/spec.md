# Spec: scroll-view / swiper 属性补全

- **ID**: 009-scroll-swiper-props
- **状态**: done
- **日期**: 2026-09-04

## 1. 要解决什么

两个标签早就有，但只做了「能滚 / 能翻」这一层，属性几乎是空的。对着小程序
文档的属性表数：**scroll-view 缺 8 项，swiper 缺 9 项**。

现状（`node_adapters.dart` 的 `_ScrollViewNodeAdapter` / `_SwiperNodeAdapter`、
`web/components/basic.ts` 与 `swiper.ts`）：

| | 有 | 没有 |
|---|---|---|
| `scroll-view` | 横竖向（用样式键 `direction`）、离屏剔除 | `scroll-top` / `scroll-left`、`scroll-into-view`、`scroll-with-animation`、`@scroll`、`@scrolltoupper` / `@scrolltolower` 与两个 threshold |
| `swiper` | `@change`（索引串）| `current`、`autoplay`、`interval`、`duration`、`circular`、`vertical`、`indicator-dots` / `indicator-color` / `indicator-active-color`、`swiper-item` |

由此产生的具体问题：

1. **滚动位置不可控**。做「回到顶部」「定位到某条」「切 tab 时记住位置」都不行
   —— 没有 `scroll-top`，也没有 `scroll-into-view`。
2. **触底加载写不出来**。没有 `@scrolltolower`，无限列表只能靠 `list-view`
   的 `@scroll` 自己算偏移，而 `scroll-view` 上连 `@scroll` 都没有。
3. **轮播不能自动播、不能循环、不能受控**。`swiper` 目前只会「手指划一页」，
   首页 banner 这种最常见的用法要自己 setInterval + 改 key 硬来，而且没有指示点。
4. **`swiper-item` 不存在**。照小程序写法 `<swiper><swiper-item>…` 的页面搬过来，
   每个 `swiper-item` 会被当成**一页里的一个普通容器**——不报错，但页数不对。

## 2. 不做什么（Non-goals）

- **scroll-view 的 `refresher-*`**（自定义下拉刷新）：fjs 已经有 `<refresh>`
  标签做这件事，再加一套是两种写法解决同一问题。
- **`enhanced` 那一族**（`bounces` / `show-scrollbar` / `fast-deceleration` /
  `dragstart` / `dragging` / `dragend`）：小程序里要先开 `enhanced` 才生效，
  且大半是 iOS 专有的手感开关。
- **`enable-flex` / `scroll-anchoring` / `enable-back-to-top`**：分别是布局兼容
  开关、CSS `overflow-anchor` 和 iOS 状态栏手势，都不属于「属性补全」这一组。
- **swiper 的 `display-multiple-items` / `previous-margin` / `next-margin` /
  `easing-function` / `direction`**：一次显示多张、露出前后一截，是另一种布局
  模式，不是补属性；`PageView` 要换成 `PageView` + `viewportFraction` 甚至自绘。
- **Skyline 专有**（`layout-type` / `transformer-type` / 各种 `indicator-*`
  动画）：微信自己的新渲染器专有。
- **`@transition` / `@animationfinish`**：逐帧位移与动画结束回调，暂不需要。
- **Android 验证**：只在 Web 与 iOS 模拟器上验收（沿用 007/008 的约定）。

## 3. 用户可见的行为

### 3.1 scroll-view

```vue
<scroll-view
  class="list"
  scroll-y
  :scroll-top="top"
  scroll-into-view="row-12"
  scroll-with-animation
  :lower-threshold="80"
  @scroll="onScroll"
  @scrolltolower="loadMore"
  @scrolltoupper="onTop"
>
  <view v-for="i in rows" :id="`row-${i}`" :key="i" class="row">{{ i }}</view>
</scroll-view>
```

- `scroll-top` / `scroll-left`：设置滚动位置。**受控但不粘手**——用户自己滚过
  之后，只有当这个值再次变化时才会跳过去（和 `input` 的 `value` 一个脾气）。
- `scroll-with-animation`：上面这个跳变走 250ms 动画。
- `scroll-into-view`：值是某个子节点的 `id`，滚到它。找不到时 `warnOnce`。
- `@scroll` 载荷是 JSON 串
  `{"scrollTop":..,"scrollLeft":..,"scrollHeight":..,"scrollWidth":..,"deltaX":..,"deltaY":..}`，
  字段名和小程序一致。
- `@scrolltoupper` / `@scrolltolower`：越过 `upper-threshold` /
  `lower-threshold`（默认 50）时各派一次，**离开阈值区再回来才会重新派**，
  否则一次触底会连发几十条。
- `scroll-x` / `scroll-y`：方向。与现有的样式键 `direction: horizontal` 并存，
  见 §7 Q1。

### 3.2 swiper

```vue
<swiper
  class="banner"
  :current="page"
  autoplay
  :interval="3000"
  :duration="400"
  circular
  indicator-dots
  indicator-active-color="#007aff"
  @change="(i: string) => (page = Number(i))"
>
  <swiper-item v-for="b in banners" :key="b.id">
    <image :src="b.src" />
  </swiper-item>
</swiper>
```

- `current`：受控页码，改它就翻过去（有动画，时长取 `duration`）。
- `autoplay` / `interval`：自动翻页；手指按住时暂停，松开继续。
- `circular`：最后一页再翻回到第一页。
- `vertical`：改成上下翻。
- `indicator-dots` / `indicator-color` / `indicator-active-color`：底部指示点。
- `swiper-item`：一页一个。**裸子节点仍然算一页**，老页面不用改（§7 Q2）。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| `scroll-view` 位置控制 | `ScrollController.jumpTo` / `animateTo` | `scrollTo({ behavior })` |
| `scroll-into-view` | 目标节点的 `RenderBox` 位置换算成偏移 | `element.scrollIntoView` 的等价偏移计算（不用原生 API，免得带上它自己的对齐规则）|
| `@scroll` | `NotificationListener<ScrollNotification>` | `scroll` 事件 |
| 触顶/触底 | 由同一份阈值判断算出，不用 Flutter 的 `atEdge` | 同一份判断，逐字节相同的载荷 |
| `swiper` 翻页 | `PageController`（`animateToPage` / `viewportFraction: 1`）| 现有的自驱轨道（`scrollLeft` + transform）|
| `autoplay` | `Timer.periodic`，按住暂停 | `setInterval`，`pointerdown` 暂停 |
| `circular` | `PageView` 的无限 builder 取模 | 轨道两端各复制一页 |
| 指示点 | widget 层画（`Stack` 底部一排小圆点）| 同一组数值的 CSS 圆点 |
| 事件载荷 | `@change` 仍是索引串；`@scroll` 是 JSON 串 | 同左 |
| 已知差异 | iOS 滚动有弹性回弹，触底事件在回弹期间不重复派 | 无回弹；阈值判断相同 |

**指示点为什么在 widget 层而不是 JS 包**（宪法 VII 的自查）：`swiper` 的子节点
就是「页」，JS 侧再塞一个绝对定位的圆点容器进去会多出一页。要在 JS 侧画就得
把 swiper 整个改成组件包一层原生 pager，那是重构不是补属性。指示点跟着 pager
走，两端各画一次，数值同源。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议 —— **不涉及**。
- [ ] natives 表 —— **不涉及**。
- [x] **事件类型**：新增 `onScrollToUpper` / `onScrollToLower` 两个号
      （24 / 25），三处同步（`ui/element.ts`、`lib/src/ffi.dart`、
      `native/include/fjs.h`）。`@scroll` 复用已有的 `scroll`(12)，但
      **载荷从「偏移数字串」变成 JSON 串** —— 见 §7 Q3。

其它同步点：`tags.json`（+`swiper-item`）、`vue-global.d.ts`、
`node_adapters.dart`、`web/components/{basic,swiper}.ts`、`base-css.ts`
（指示点）。

## 6. 验收标准

1. `pnpm run typecheck` 通过。
2. `pnpm test` 通过；新增用例覆盖：阈值进出各派一次（不连发）、`scroll-top`
   受控但不打断用户滚动、`scroll-into-view` 找不到目标时告警、`circular` 的
   索引取模、`autoplay` 按住暂停。
3. `cd packages/flutter_fjs && flutter test` 通过（先编 native；`No tests ran`
   视为失败）。新增 `scroll_view_props_test.dart` 与 `swiper_props_test.dart`。
4. `pnpm --filter hello-fjs run typecheck` 通过。
5. hello-fjs 的 `comp/scroll-view.vue` 与 `comp/swiper.vue` 扩成能演示新属性
   （触底加载、跳转到某条、自动播 + 指示点 + 受控页码）。
6. 两端对拍：Web（`dev:web`）与 iOS 模拟器（`run:ios`）——触底只派一次、
   `scroll-into-view` 落到同一条、自动播间隔一致、指示点位置与配色一致、
   `circular` 从末页翻回首页。**Android 不测**。
7. 文档：`docs/ui-api.md`（两个标签的属性与事件）、`docs/web.md`（回弹差异）、
   `docs/roadmap.md` 打勾。

## 7. 待澄清

三条已由用户拍板（2026-09-04），按推荐项定稿：

- [x] **Q1 方向 → A（并存，prop 优先）**：`scroll-x` / `scroll-y` 为准，没写
      时回落到样式键 `direction`，都没有就纵向。老页面与 demo 一行不改。
      `direction` 不标废弃——它是样式，`scroll-x` 是属性，两者本来就在不同的
      层，文档里写清优先级即可。
- [x] **Q2 `swiper-item` → 裸子节点仍算一页**：`swiper` 的直接子节点，无论是不
      是 `swiper-item`，都算一页。比小程序宽松（它规定「只可放置
      swiper-item」），换来 `examples/hello-fjs` 现有 swiper 页零改动。文档写明
      这条差异。
- [x] **Q3 `@scroll` 载荷 → A（两个标签统一成 JSON）**：`scroll-view` 与
      `list-view` 都发
      `{"scrollTop":..,"scrollLeft":..,"scrollHeight":..,"scrollWidth":..,"deltaX":..,"deltaY":..}`，
      字段名对齐小程序。**这是面向用户的 breaking change**：`list-view` 的
      `@scroll` 从偏移数字串变成 JSON 串，页面要把 `Number(v)` 改成
      `JSON.parse(v).scrollTop`。理由是宁可破一次，也不留「同一个事件号两种
      载荷形状、Dart 侧要看 tag 才能解释」的债——007 里正是以此拒绝复用
      `textSubmitted`。plan 要把迁移单列一步：改 `examples`/`demo` 里所有
      `@scroll` 的用法，并在 `docs/ui-api.md` 与 `docs/roadmap.md` 标注。
