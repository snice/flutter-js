# Spec: @media 响应式样式

- **ID**: 043-media-queries
- **状态**: done
- **日期**: 2026-09-12

## 1. 要解决什么

roadmap「近期计划 · CSS 扩展」第一条。页面写 `@media (min-width: 600px)`
做响应式布局（转屏、平板分栏、桌面窗口拖宽），现状是：

- **App 端**：`css/parser.ts` 对 at-rule 一律 `warnOnce` 整块跳过
  （parser.ts:65-68），规则不生效；
- **Web 端**：`<style>` 是真 CSS，浏览器原生求值，**规则生效**。

同一份页面两端表现分叉，且没有兜底手段（JS 拿不到窗口尺寸，页面想做
响应式只能监听事件手写）。这是 css-compat.md 选择器表里登记的
`@media ❌` 缺口。

另一个隐含缺口：JS 侧（CSS 引擎所在的层）目前**没有任何窗口尺寸来源**——
没有宿主调用，也没有尺寸变化通知。本 spec 要先打通这条通道。

## 2. 不做什么（Non-goals）

- **transition / animation**：近期计划里另一个独立子项，本 spec 不碰。
- **@supports / 容器查询 / @import / @font-face**：不支持，照旧 warnOnce 跳过。
- **`prefers-color-scheme`**：待澄清（§7），默认不做。
- **命名断点**（如 Tailwind 的 `sm:/md:/lg:` 或 uni-app 式 rpx）：不做，只做
  标准 `@media` 语法；页面自己按 px 写断点。
- **JS 侧 `matchMedia` API**：不做。响应式判断走 CSS。
- **rem / vw / vh 单位**：维持现状（构建期换算 / 不支持）。
- Web 端求值器不自己做：web 是浏览器原生 `@media`，只保证 fjs 的样式改写
  （`rewriteFjsCss`）能正确进入 media 块内部，不改写浏览器行为。

## 3. 用户可见的行为

```vue
<template>
  <view class="layout">
    <view class="side">侧栏</view>
    <view class="main">主区</view>
  </view>
</template>

<style scoped>
.layout { display: flex; flex-direction: column; }
.side { display: none; }

@media (min-width: 600px) {
  .layout { flex-direction: row; }
  .side { display: flex; width: 200px; }
  .main { flex-grow: 1; }
}
</style>
```

- 窄屏（手机竖屏）只有主区；转横屏或拖宽窗口（≥600 逻辑像素）出现侧栏，
  **App 与 web 同一断点、同一表现**，页面源码不改。
- App 端转屏 / 分屏 / 桌面拖窗后**立即重排**，不需要重启页面。
- 嵌套普通规则：media 块内的规则与块外同层参与级联（specificity + 源顺序），
  与浏览器一致。
- `@media` 可以叠：同一张表里多条 media 块各自独立。
- Vue scoped 照常：media 块内的选择器仍带 scope 属性匹配。
- 不支持的 media 特性（如 `prefers-reduced-motion`）：该条 media 块
  `warnOnce` 后整体按不匹配跳过，块内规则不下发（宪法 V）。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 求值方 | JS 侧 CSS 引擎：规则带 media 条件存储，按当前窗口逻辑尺寸匹配；条件变化时受影响元素全量重算样式，走既有 `setProps` 下发（**op 协议零改动**） | 浏览器原生 `@media`，**生产代码零改动**。已核实：web 构建 `<style>` 走 `injectStyle` 真 CSS，StyleEngine 在 web 上不接样式；`rewriteFjsCss` 的三个改写是全文正则，media 块内部天然覆盖，只需回归测试钉住 |
| 参照物 | Flutter 窗口逻辑尺寸（`MediaQuery.size`，即 devicePixelRatio 归一后的逻辑像素）——与 web 视口 CSS 像素同基准 | 浏览器视口（CSS 像素） |
| 支持的语法 | media type：`screen` / `all`（`only` 前缀容忍；`print` 等其他 type 整块跳过并告警）；特性：`min-width` / `max-width` / `width` / `min-height` / `max-height` / `height` / `orientation: portrait\|landscape`；组合：`and`、逗号（或）；单位 px 与无单位 | 同左（浏览器是超集；页面写超集特性时 web 原生生效、App 不生效——登记进 css-compat 已知差异，并在 App 端告警） |
| 尺寸通道 | **新增**：JS 侧初始从宿主同步取一次窗口尺寸；Dart 在窗口尺寸变化时推送。通道复用既有 dispatchEvent 范式，新增一个事件号（三处同步，宪法 II） | 不需要：浏览器自己知道 |
| 事件载荷 | `{"width":n,"height":n}`，字段序固定，数值一位小数，两端同源 | 不派发 |

已知差异（登记 css-compat.md）：
- web 求值是浏览器原生，特性集是超集；只写上表特性时两端逐断点一致。
- `orientation` 的判定：App 按窗口宽高比较，web 按**视口**宽高比较；桌面浏览器
  上窗口比例与 App 全屏窗口比例可能不同属正常差异。
- 首帧：App 端规则匹配用启动时取到的初始尺寸，与 web 首帧一致。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）：**不涉及**（样式重算走既有 setProps 路径）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）：视初始尺寸获取方式而定——
  若走 `invokeHost('fjs.viewport')` 返回 JSON 串则零改动，若新开 natives 函数则同步
- [x] 事件类型（`element.ts` `EventType` + `fjs.h` `FJS_EVENT_*` + 运行时
  `registerSystemHandler` 注册处）：新增 `FJS_EVENT_VIEWPORT_CHANGED = 33`，三处同步
- 其余：`css/parser.ts`（media 条件解析 + CssRule 结构扩展）、`css/style.ts`
  （按视口过滤 + 失效重算）、`vue/renderer.ts`（事件接线）、Dart 侧
  `ffi.dart` / `engine.dart` / `fjs_view.dart`（尺寸推送）、
  `docs/css-compat.md`（表格 + 差异登记）、`docs/roadmap.md`（打勾）；
  web 侧仅补 `rewriteFjsCss` 的 media 块回归测试，无生产改动

## 6. 验收标准

1. `pnpm test` 通过：parser 新增 media 条件用例（合法 / 非法 / 不支持特性
   warnOnce）、StyleEngine 按视口过滤与失效重算用例、`rewriteFjsCss`
   media 块递归用例（块内 `flex-grow` 被改写）。
2. `pnpm --filter demo run typecheck`、`pnpm run typecheck` 通过。
3. hello-fjs 新增「响应式布局」示例页（§3 的侧栏形态 + 至少一个
   `orientation` 用例），`fjs dev --web` 下拖窄/拖宽浏览器窗口表现与
   `fjs run ios` 模拟器转屏（Cmd+←/→）一致：同一断点值、同一布局变化。
4. App 端转屏后样式即时更新（观察得到，不需要重新进入页面）。
5. `@media print { … }` 与不支持特性在控制台各告警一次，规则不生效（两端
   演示页可见）。
6. `fjsrun dist/bundle.js` 跑示例页不崩（无宿主时 viewport 尺寸走默认值
   —— 具体回落值在 plan 定，登记在文档）。

## 7. 待澄清

- [ ] `prefers-color-scheme`（深色模式）要不要随本 spec 一起做？App 端可以
  从 Flutter 拿 `platformBrightness` 并在事件载荷里带上，但深色模式是「整套
  配色切换」而不是响应式布局，单独一个 spec 更合适。**默认：不做，另行开 spec。**
- [ ] 初始尺寸的获取方式（§5 natives 行）需要在 plan 阶段对着
  `engine.dart` 的启动时序定；若 `invokeHost` 在 prelude 阶段还不可用，
  改走「Dart 启动后主动推一发事件」的方案（那 natives 表就零改动）。
- [ ] 无宿主环境（fjsrun / 老版本宿主）的默认尺寸回落值：建议 390×844
  （对齐 iPhone 14 主流竖屏），plan 阶段定稿。
