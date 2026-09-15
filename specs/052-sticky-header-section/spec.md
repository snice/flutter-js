# Spec: 全端 sticky 吸顶（sticky-header / sticky-section / position: sticky）

- **ID**: 052-sticky-header-section
- **状态**: ready
- **日期**: 2026-09-15

## 1. 要解决什么

分组列表的「组头吸顶」是移动端最高频的滚动模式之一（联系人字母分组、订单
按日分组、tab 吸顶）。今天三端都做不了：

- `docs/css-compat.md:100` 明确 `position: fixed / sticky` 为 ❌；
- 微信小程序 Skyline 的官方解法 `sticky-header` / `sticky-section`
  组件（见参考链接）在本仓库的 mp 编译管线里没有映射：
  scroll-view 会被强制注入 `type="list"` 并包一层 `.fjs-scroll-inner`，
  而 skyline 的 sticky 组件要求必须是
  `<scroll-view type="custom">` 的**直接子节点**，现状编译出来直接失效；
- Flutter 端 scroll-view 是 `SingleChildScrollView` + Column，没有
  Sliver 基础设施，无从吸顶。

参考：[sticky-header](https://developers.weixin.qq.com/miniprogram/dev/component/sticky-header.html) ·
[sticky-section](https://developers.weixin.qq.com/miniprogram/dev/component/sticky-section.html)

## 2. 不做什么（Non-goals）

- **不做**通用 CSS `position: sticky` 在 Flutter 端的样式级支持
  （任意元素吸顶需要重写整个定位布局层）。Flutter 端吸顶只走
  `sticky-header` / `sticky-section` 标签；样式级 `position: sticky`
  在 web / mp-webview 端本来就是浏览器/WebView 原生能力，开放契约并在
  文档登记差异，Flutter 端遇到该样式值 `warnOnce` 指向标签方案（宪法 V）。
- 不做 `position: fixed`。
- 不做 sticky-header 的 `padding` 属性（微信 3.0.0 加入，与吸顶语义无关，
  页面在外层节点上自己写 padding 即可）。属性会被透传/接受但不产生效果，
  文档登记。
- 不做横向吸顶（scroll-x 下的 sticky-left）。
- 不改 list-view / swiper 的既有行为。

## 3. 用户可见的行为

```vue
<!-- 分组吸顶：经典用法，三端一致 -->
<scroll-view type="custom" scroll-y style="height: 420px">
  <sticky-section v-for="g in groups" :key="g.name">
    <sticky-header>
      <view class="cap">{{ g.name }}</view>
    </sticky-header>
    <view v-for="it in g.items" :key="it" class="row">{{ it }}</view>
  </sticky-section>
</scroll-view>

<!-- sticky-header 直接做 scroll-view 子节点：整段滚动内一直吸住 -->
<scroll-view type="custom" scroll-y style="height: 300px">
  <sticky-header :offset-top="8"><view>顶部工具条</view></sticky-header>
  <view>内容…</view>
</scroll-view>
```

- `sticky-section`：吸顶分组容器。属性 `push-pinned-header`
  （默认 `true`：本组吸顶元素到达顶部时把前一个推走）。
- `sticky-header`：吸顶块。属性 `offset-top`（number，px，吸顶时距滚动
  视口顶部的距离，默认 0）、`allow-overlapping`（默认 `false`）。
- 事件 `@stickontopchange`（sticky-header）：吸顶状态变化时触发一次，
  载荷为 JSON 字符串 `'{"isStickOnTop":true}'`（两端事件载荷一律字符串）。
- `position: sticky` 样式：web 与 mp（webview 渲染器）原生生效；
  Flutter 端 warnOnce。
- mp 编译：页面写了静态 `type="custom"` 的 scroll-view 时，
  不再注入 `type="list"`、不再包 `.fjs-scroll-inner`（直接子节点是
  sticky 语义的前提）；webview 渲染器下 sticky-header/section 降级为
  `view + fjs-sticky-header/fjs-sticky-section` 类（wxss 用原生
  `position: sticky` 实现同一行为）；skyline 渲染器下原样透传。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| sticky-section | `SliverMainAxisGroup`：组内 pinned header 互推、随组边界离场 | 普通 `<view>` 容器：CSS sticky 以父容器为界，组头随组边界离场（天然同语义） |
| sticky-header 吸顶点 | `SliverPersistentHeader(pinned)`（`SliverPinnedHeader`），`offset-top` 计入 header extent 顶部 | `position: sticky; top: {offset-top}px` |
| offset-top > 0 的静止态 | extent 含 offset-top：header 上方**保留** offset-top 空隙 | 不保留空隙（CSS sticky 语义） |
| 组内多个 sticky-header | 互推（Sliver 语义，与微信默认一致） | 后者覆盖前者（纯 CSS 做不到推挤），登记为已知差异 |
| push-pinned-header=false / allow-overlapping=true | warnOnce 后按默认行为处理（Sliver 侧实现"重叠"需自绘 sliver，v1 不做） | 原生即覆盖语义，无需处理 |
| @stickontopchange | Dart 侧由滚动偏移与 header 内容偏移求差，状态翻转时 dispatch（事件号 28） | 最近滚动祖先（或 window）rAF 节流监听，状态翻转时 emit |
| 事件载荷 | JSON 字符串 `{"isStickOnTop":boolean}` | 同左 |
| scroll-view `type="custom"` | 接受并忽略（属性无语义），出现 sticky 子节点即走 sliver 布局 | 接受并忽略 |

做不到一致的（理由如上表）：offset-top>0 的静止态保留空隙（Sliver pinned
extent 必须静态声明，含间距是唯一不用自绘 RenderSliver 的做法，吸顶态
视觉完全一致）；组内多 header 推挤（纯 CSS 无解，主用法是"一组一 header"）。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）：不涉及
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）：不涉及
- [x] 事件类型：`stickontopchange` = 34 —— `element.ts` `EventType`
  （+`onStickOnTopChange` 别名）↔ `fjs.h` `FJS_EVENT_STICK_ON_TOP_CHANGE`
  ↔ `ffi.dart` `FjsEvent.stickOnTopChange`
- [x] 标签白名单：`tags.json` 新增 `sticky-header` / `sticky-section`
  （三端都作为元素/原生标签处理，不走 JS 组件；宪法 VII——吸顶需要
  Sliver / Skyline 原生布局能力，JS 包不出来，下 Dart/mp 原生有正当理由）

## 6. 验收标准

1. `pnpm run typecheck`、`pnpm test` 通过。
2. `packages/fjs/test/mp-compiler.test.ts`：scroll-view 静态 `type="custom"`
   时输出不含 `type="list"` 注入与 `.fjs-scroll-inner`；webview 渲染器下
   sticky-header 降级为 `view class="fjs-sticky-header"`；skyline 下原样透传。
3. `packages/fjs-runtime/test/`：web sticky 组件挂载、offset-top 内联样式、
   stickontopchange 触发（模拟滚动翻转一次）用例通过。
4. `packages/flutter_fjs/test/sticky_test.dart`：sliver 布局下 header 吸顶
   （拖动后 header 停在视口顶）、离场（组尾推走）、事件翻转各一条。
5. `examples/hello-fjs` 新增 `pages/comp/sticky.vue`（分组吸顶 +
   offset-top + 事件面板 + CSS sticky 块）：
   - `pnpm --filter hello-fjs run build`（web 产物）通过；
   - `pnpm --filter hello-fjs run build:mp` 通过（小程序产物编译校验）；
   - web 浏览器目验：分组头随组吸顶/离场，事件面板翻转；
   - iOS 模拟器目验：同页面同表现；
   - 微信开发者工具（skyline 渲染器）目验：原生 sticky-header 生效。
6. 文档落地（宪法 VIII）：`docs/ui-api.md`（两个新标签 + 事件）、
   `docs/css-compat.md`（position: sticky ✅/⚠️ 分端登记）、
   `docs/miniprogram.md`（type="custom" 透传规则、webview 降级）。

## 7. 待澄清

- 无（组内多 header 的 web 推挤差异、offset-top>0 静止态差异按 §4
  登记处理；若用户要求完全一致，web 端需引入 JS 测量推挤，作为后续 spec）。
