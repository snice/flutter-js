# Plan: 全端 sticky 吸顶

对应 spec：`./spec.md`。宪法自查：I 两端同源（web 组件 ↔ Dart adapter 成对）；
II 事件号 28 三处同步；V 不支持处 warnOnce；VII 吸顶需要 Sliver / Skyline
原生布局能力，下 Dart/原生有正当理由；VIII 文档三处。

## 改动分层

### 1. 契约层（宪法 II）

- `packages/fjs-runtime/src/ui/element.ts`：`EventType` 增
  `onStickontopchange: 28`（+`onStickOnTopChange` 别名 28）。
- `packages/flutter_fjs/native/include/fjs.h`：`FJS_EVENT_STICK_ON_TOP_CHANGE = 28`
  （取 27 之后的下一个空位，实现时核对）。
- `packages/flutter_fjs/lib/src/ffi.dart`：`FjsEvent.stickOnTopChange = 28`。
- `packages/fjs-runtime/src/tags.json`：+ `sticky-header`、`sticky-section`。

### 2. Web 端（`packages/fjs-runtime/src/web/`）

- 新建 `web/components/sticky.ts`：
  - `FjsStickyHeader`：props `offsetTop`(number|string, px)、
    `padding`(接受但 v1 不生效，登记)、`allowOverlapping`(接受不生效)；
    渲染 `<sticky-header>` 自定义元素，内联 `top: {offsetTop}px`；
    emits `stickontopchange`——最近滚动祖先（兜底 window）rAF 节流监听，
    `rect.top <= offsetTop+0.5 && scrollTop+offsetTop >= naturalTop-1` 判定，
    仅状态翻转时 emit，载荷 `JSON.stringify({isStickOnTop})`。
  - `FjsStickySection`：props `pushPinnedHeader`(接受，web 纯 CSS 即覆盖
    语义，登记差异)；渲染 `<sticky-section>` 块容器。
- `web/components/index.ts`：注册两组件。
- `web/base-css.ts`：`sticky-header { display:block; position:sticky; top:0; z-index:1 }`、
  `sticky-section { display:block }`（z-index 是组件自身默认样式的一部分，
  不开放给用户 CSS；Flutter 侧 sliver 天然画在上层）。

### 3. Flutter 端（`packages/flutter_fjs/lib/src/`）

- `widgets/scroll_view.dart`：`FjsScrollView` 增可选 `slivers` 参数；
  非 null 时走 `CustomScrollView(controller/slidDirection/PageStorageKey 同现状)`，
  通知/事件/受控 props 逻辑共用。滚动回调里增 `_probeSticky()`：
  遍历 viewport slivers，`RenderSliverPersistentHeader` 且 delegate 是
  `FjsStickyHeaderDelegate` 时，
  `stuck = pixels >= sliver.constraints.scrollOffset - ε && paintExtent >= extent - ε`
  （组内被推走时 paintExtent 收缩 → 翻 false），翻转且
  `onStickontopchange` handler 存在才 dispatch 28。
- 新建 `widgets/sticky.dart`：
  - `FjsStickyHeaderDelegate(pinned)`：extent = offsetTop + 实测 child 高
    （layout 后回填，变才会 notify），build 返回
    `Padding(top: offsetTop) > child`。
  - `fjsStickySlivers(nodes, buildChild, style, warn)`：把 scroll-view 直接
    子节点切成 run（普通节点段 → `SliverToBoxAdapter(Column)`，保住
    Column 的 stretch 语义）+ `SliverPersistentHeader(pinned)`（sticky-header，
    offset-top 取 num prop）+ `SliverMainAxisGroup`（sticky-section：组内
    header pin、随组边界离场；push-pinned-header=false 时每个 header 独立
    成组 → 覆盖语义）。offset-top>0 静止态保留空隙的差异见 spec §4。
- `node/node_adapters.dart`：`_ScrollViewNodeAdapter` 检测直接子节点含
  sticky 标签 → sliver 模式（decoration 包在 CustomScrollView 外，
  padding 转 `SliverPadding`）；新增 `_StickyHeaderNodeAdapter` /
  `_StickySectionNodeAdapter`（普通路径 = buildBox + warnOnce
  "必须在 type=custom scroll-view 内"）。

### 4. mp 编译（`packages/fjs/src/mp/wxml.ts`）

- 静态 `type="custom"` 的 scroll-view（helper `isCustomScrollView`）：
  - 不注入 `type`/`enable-flex`（现有 per-attr 让位逻辑核对补齐）；
  - 不包 `.fjs-scroll-inner`（sticky 必须是直接子节点）；
  - 根级不降级为 view（skyline 无页面级滚动，custom scroll-view 需要
    确定高度——现有缺高度编译报错继续兜底）。
- webview 渲染器：`sticky-header`/`sticky-section` 降级
  `view` + `fjs-sticky-header`/`fjs-sticky-section` 类（css.ts 补
  `position: sticky; top: 0; z-index: 1`）；静态数字 `offset-top` 映射成
  内联 `top: Npx`，绑定的 offset-top warnOnce 不生效。
- skyline 渲染器：原样透传（组件本身是 skyline 内置），事件
  `@stickontopchange` → `bindstickontopchange` 走现有折叠规则，无需改。

### 5. demo 与测试

- `examples/hello-fjs/src/pages/comp/sticky.vue`：分组吸顶（v-for 组）、
  整段 sticky-header + offset-top、`@stickontopchange` 事件面板、
  CSS `position: sticky` 块。
- `packages/fjs/test/mp-compiler.test.ts`：custom 注入让位/无 inner 包裹/
  根不降级、webview 降级类、skyline 透传。
- `packages/fjs-runtime/test/web-sticky.test.ts`：挂载、top 内联、
  滚动翻转 emit 一次。
- `packages/flutter_fjs/test/sticky_test.dart`：仿
  `scroll_view_props_test.dart` 的树构造；sliver 布局吸顶/离场/事件翻转。

### 6. 文档（宪法 VIII）

- `docs/ui-api.md`：组件表 + §新标签两节（props/事件/三端差异）。
- `docs/css-compat.md`：`position: sticky` 改 ⚠️（web/mp 原生；Flutter 走
  标签），z-index 组件内部默认值加注。
- `docs/miniprogram.md`：`type="custom"` 透传规则、webview 降级。

## 顺序

契约层 → web → Flutter → mp 编译 → demo → 测试 → 文档 → 验收
（typecheck / pnpm test / build / build:mp / flutter test）→
三端目验（web 浏览器、iOS 模拟器 fjs-go、微信开发者工具 skyline）。
