# Spec: web-view 嵌套 Flutter 滚动

- **ID**: 016-webview-nested-scroll
- **状态**: draft
- **日期**: 2026-09-04

## 1. 要解决什么

`<web-view>` 放进 Flutter 侧的 `<scroll-view>` 后，WebView 平台视图与外层
`SingleChildScrollView` 竞争同一个垂直拖拽手势。当前没有为 WebView 配置明确的手势
接收策略，用户在网页内容上上下拖动时，网页不能正常滚动，嵌套内容的交互失效。

## 2. 不做什么（Non-goals）

- 不改变 `<web-view>` 的 `src`、`@load`、`@error`、`@message` 契约。
- 不改变 Web 侧 iframe 的滚动行为或 CSS 兼容规则。
- 不实现网页滚动位置与外层 Flutter 滚动位置之间的联动、穿透或自动边界传递。
- 不新增 UI op、FFI/C ABI、事件号或 JavaScript/Dart 通信。
- 不修改 `scroll-view` 的公共 props、事件和滚动指标。

## 3. 用户可见的行为

页面可以把有明确高度的 WebView 放进 Flutter 滚动容器：

```vue
<template>
  <scroll-view class="page" scroll-y>
    <text>上面的 Flutter 内容</text>
    <web-view src="asset://demo.html" class="web-frame" />
    <text>下面的 Flutter 内容</text>
  </scroll-view>
</template>

<style>
.page { flex-grow: 1; }
.web-frame { height: 320px; }
</style>
```

在 Flutter app 上：

1. 手指从 WebView 网页内容开始拖动时，网页自身可以上下滚动；
2. 手指从 WebView 之外的兄弟节点开始拖动时，外层 `scroll-view` 仍可以滚动；
3. WebView 仍然响应网页内的链接、按钮和 `fjs.postMessage`；
4. 页面不需要新增 prop、事件或平台专用代码。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 嵌套滚动 | 为平台 WebView 配置明确的手势接收器，使网页内容在 WebView 区域内获得垂直拖拽；WebView 外仍由外层 `scroll-view` 处理 | iframe 保持现有浏览器原生滚动与父页面滚动行为 |
| 事件载荷 | `@load` / `@error` / `@message` 与现有逐字符一致 | 不变 |
| 已知差异 | Flutter 平台视图的手势竞技场由 `webview_flutter` 管理，WebView 内外的拖拽归属依触点区域决定 | 浏览器由 iframe/native pointer 机制决定嵌套滚动，不能保证与 Flutter 的竞技场时序完全相同 |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

## 6. 验收标准

1. `cd packages/fjs-webview/flutter && flutter test` 通过，并包含 WebView 手势配置的回归断言。
2. `cd packages/fjs-webview/flutter && flutter analyze` 通过。
3. `pnpm --filter @ufjs/webview run typecheck` 通过。
4. `pnpm test` 通过，既有 WebView 与滚动相关 JS 测试不回归。
5. 在 Flutter widget/integration 验证页中，把带高度的 `<web-view>` 放进 `<scroll-view>`：
   从网页内容上拖动可以改变网页内部滚动位置。
6. 在同一验证页中，从 WebView 上方或下方的 Flutter 内容拖动，外层
   `<scroll-view>` 的偏移可以改变。
7. 在同一验证页中点击网页按钮，`@message` 仍收到 `{"data":"..."}`；网页加载与 src
   切换行为不回归。
8. 确认变更只涉及 Flutter WebView 模块实现、对应测试和必要的文档/示例，不修改 UI op、
   FFI/C ABI、事件号、Web 侧 iframe 契约。

## 7. 待澄清

- 无
