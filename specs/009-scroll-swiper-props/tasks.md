# Tasks: scroll-view / swiper 属性补全

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 在 `packages/fjs-runtime/src/ui/element.ts` 的 `EventType` 加 `onScrollToUpper: 24` / `onScrollToLower: 25`。
- [x] T002 在 `packages/flutter_fjs/lib/src/ffi.dart` 的 `FjsEvent` 加对应两个常量；注释写清 `scroll`(12) 的载荷已改成 JSON 串。
- [x] T003 在 `packages/flutter_fjs/native/include/fjs.h` 的枚举补 24 / 25，并更新 12 的载荷说明（C++ 不解释事件号，不需重编）。
- [x] T004 在 `packages/fjs-runtime/src/tags.json` 加 `swiper-item`。
- [x] T005 在 `packages/fjs-runtime/src/vue-global.d.ts` 补 `FjsScrollViewProps`（scroll-x/y、scroll-top/left、scroll-into-view、scroll-with-animation、两个 threshold、三个事件）、扩写 `FjsSwiperProps`（current/autoplay/interval/duration/circular/vertical/三个 indicator-*），并在两处注册 `swiper-item` 的 kebab 与 Pascal 名。

## 实现

### 共用语义（先钉死，两端照它写）

- [x] T010 新增 `packages/fjs-runtime/src/scroll/metrics.ts`：`scrollPayload()`（六字段、字段顺序固定）、`edgeState()`（进入/离开阈值区的状态机）、`wrapIndex()`（circular 取模）。不依赖 Vue / DOM。
- [x] T011 新增 `packages/fjs-runtime/test/scroll-metrics.test.ts`：载荷字段与顺序、阈值「进入才派、待在区里不派、离开再回来重派」、`wrapIndex` 的 -1 / count / 2*count 边界。

### 载荷迁移（breaking change，单独跑绿再往下）

- [x] T012 新增 `packages/flutter_fjs/lib/src/render/scroll_metrics.dart`（Dart 侧镜像那份共用语义，注释指回 `scroll/metrics.ts`），并改 `list_view.dart` 的 `_onScroll`：从 `toStringAsFixed(1)` 改成发同一份 JSON（字段与 `scroll/metrics.ts` 一致）。
- [x] T013 改 `packages/fjs-runtime/src/components/list-view.ts` 的 `consumeScroll` / `onScroll`（第 71-100 行附近）：读 JSON 的 `scrollTop`，emit 也换成新载荷。**这里错了长列表会停止加载但不报错**（plan §4 风险 2）。
- [x] T014 改 `packages/fjs-runtime/src/web/components/list-view.ts`：滚动上报走同一份载荷。
- [x] T015 跟着改现存仅有的两个消费者：`packages/fjs-runtime/test/web-list-view.test.ts`、`packages/flutter_fjs/test/nav_router_test.dart`。补一条「滚到底仍在追加」的用例。
- [x] T016 跑一次 `pnpm test` + `flutter test`，确认迁移这一步单独是绿的，再开始新功能。

### scroll-view（Dart）

- [x] T020 新增 `packages/flutter_fjs/lib/src/widgets/scroll_view.dart`：把 `_ScrollViewNodeAdapter` 的现有实现搬进来（保留离屏剔除与 PageStorageKey），接上 `ScrollController`。
- [x] T021 在它上面实现 `scroll-top` / `scroll-left` / `scroll-with-animation`：照 `input` 的 `_lastPropValue` 那套「受控但不粘手」（plan §3.4）。
- [x] T022 实现 `@scroll`：`NotificationListener<ScrollNotification>` + 一帧一次合并，载荷走 `scrollPayload` 的字段。
- [x] T023 实现 `@scrolltoupper` / `@scrolltolower` 与 `upper-threshold` / `lower-threshold`（默认 50），判断走 `edgeState` 的状态机语义。
- [x] T024 实现 `scroll-into-view`：给带 `id` 属性的节点发 `GlobalKey`（`MirrorTree.globalKeyFor`，见 plan §3.8 实施修正），postFrame 里量位置再滚过去；找不到目标 `warnOnce`。
- [x] T025 改 `packages/flutter_fjs/lib/src/render/style.dart` 的 `scrollDirection`：`scroll-x` / `scroll-y` 两个 prop 优先于样式键 `direction`；两者同时为真时取纵向并 `warnOnce`。

### swiper（Dart）

- [x] T030 新增 `packages/flutter_fjs/lib/src/widgets/swiper.dart`：把 `_SwiperNodeAdapter` 搬进来，接上 `PageController`。
- [x] T031 实现 `current`（受控、只有 prop 变化才 `animateToPage`，派发时不回写自己）与 `duration`；越界钳到末页并 `warnOnce`。
- [x] T032 实现 `autoplay` / `interval`：`Timer.periodic`，手指按住暂停、松开继续。
- [x] T033 实现 `circular`：`PageView.builder` 不给 itemCount，索引走 `wrapIndex`；`@change` 永远派真实索引（plan §3.5）。
- [x] T034 实现 `vertical`。
- [x] T035 实现指示点：`Stack` 底部一排小圆点，直径 8 / 间距 4 / 距底 16 / 未选中 `rgba(0,0,0,0.3)` / 选中 `#000000`，`indicator-color` 与 `indicator-active-color` 可覆盖；`vertical` 时移到右侧竖排。
- [x] T036 在 `packages/flutter_fjs/lib/src/node/node_adapters.dart` 把两个 adapter 改成薄封装，并注册 `swiper-item`（普通容器，不下 Dart 行为）。

## 两端对齐

- [x] T040 在 `packages/fjs-runtime/src/web/components/basic.ts` 的 `FjsScrollView` 实现同一组 scroll-view 属性：scroll-x/y、scroll-top/left（+`behavior: smooth`）、scroll-into-view、`@scroll`、两个阈值事件（共用 `edgeState`）。
- [x] T041 在 `packages/fjs-runtime/src/web/components/swiper.ts` 实现 current / autoplay / interval / duration / circular（两端各复制一页，跳回真页时无动画）/ vertical / 指示点。
- [x] T042 在 `packages/fjs-runtime/src/web/components/index.ts` 注册 `swiper-item`；`packages/fjs-runtime/src/web/base-css.ts` 加指示点几何与 `swiper-item` 默认盒模型，数值与 Dart 侧逐个相同。
- [x] T043（两端一致，见 T055/T056 的实机记录：`@scroll` 六字段同序、触底两端各 1 次、`circular` 两端都报真实索引）两端对拍事件载荷：`@scroll` 的 JSON（字段顺序）、`@scrolltoupper` / `@scrolltolower` 的条数、`@change` 在 `circular` 下给的真实索引 —— 逐字节相同。

## 测试

- [x] T050 新增 `packages/fjs-runtime/test/web-scroll-swiper.test.ts`（**抓到一个真 bug**：`pageCount` 不是响应式，autoplay 的定时器在 setup 时按 0 页判定，永远不启动）：web 侧的阈值只派一次、`scroll-top` 不打断用户滚动、`scroll-into-view` 告警、autoplay 按住暂停、circular 索引。
- [x] T051 新增 `packages/flutter_fjs/test/scroll_view_props_test.dart`：`scroll-top` 受控语义、`@scroll` 载荷、阈值进出、`scroll-into-view` 命中与告警。
- [x] T052 新增 `packages/flutter_fjs/test/swiper_props_test.dart`（**抓到两个真 bug**：`animateToPage` 会把途经的每一页都报一次，改成只报落点；`_circularOrigin` 是 100000，与 3 页取模后起始页落在了 pages[1]，改成对页数取整）：`current` 受控、autoplay 定时、circular 的 `@change` 真实索引、指示点数量与选中态、vertical。
- [x] T053 扩 `examples/hello-fjs/src/pages/comp/scroll-view.vue`：触底加载 + 跳到某条 + 实时显示 `@scroll` 载荷。
- [x] T054 扩 `examples/hello-fjs/src/pages/comp/swiper.vue`：自动播 + 指示点 + 受控页码 + circular + vertical 开关。
- [x] T055 Web 验证（**抓到一处两端都有的布局问题**：`swiper-item` 作为「一页」没把内容撑满——web 上我先把它注册成了 `FjsView` 导致 `swiper-item > *` 规则匹配不到，Dart 侧 adapter 也少了 `growChildren`；两端一并修）：`pnpm --filter hello-fjs run dev:web`，逐条走 spec §6.6 的对照项，外加「长列表滚到底仍在追加」（plan §4 风险 2）。
- [x] T056 iOS 模拟器验证（**抓到一处只在 Flutter 上出现的哑火**：模板写 `@scrolltolower`，Vue 给出的 prop 是全小写的 `onScrolltolower`，而 `EventType` 里只有驼峰 `onScrollToLower`——element 层把不认识的 handler 静静丢掉，事件在真机上从不触发，web 侧因为不走这层所以正常。补了全小写拼写为规范名（Dart 侧本来就按它找），驼峰降为别名，并让未知 handler 走 warnOnce（宪法 V）；新增 `test/element-handlers.test.ts`）：iOS 模拟器验证：`pnpm --filter hello-fjs run run:ios`，同一份对照项；注意 iOS 回弹期间不应重复派触底。**Android 不测**。

## 文档

- [x] T060 更新 `docs/ui-api.md`：scroll-view 与 swiper 的属性/事件表、`swiper-item`、`@scroll` 的新载荷、`scroll-x` 与样式键 `direction` 的优先级、与小程序「只可放置 swiper-item」的宽松差异。
- [x] T061 更新 `docs/web.md`：iOS 回弹、`circular` 两端实现不同（取模 vs 复制页）但 `@change` 语义相同。
- [x] T062（另外把两处 Flutter 侧事件名哑火也记进去）更新 `docs/roadmap.md`：这一组打勾，并把 `@scroll` 载荷变更**单列成一条 breaking change**，写清页面要怎么改。

## 验收

- [x] T070 `pnpm run typecheck`
- [x] T071 `pnpm test`
- [x] T072 `pnpm --filter hello-fjs run typecheck`
- [x] T073 `cd packages/flutter_fjs/native && cmake -B build-native -DFJS_BUILD_TESTS=ON && cmake --build build-native -j` 后 `cd packages/flutter_fjs && flutter test`（`No tests ran` 视为失败；`nav_router_test` 那条既有失败与本 spec 无关）
- [x] T074 spec.md 第 6 节逐条核对
