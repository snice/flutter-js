# Tasks: 全端 sticky 吸顶

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层

- [x] T001 `element.ts` `EventType` + `fjs.h` + `ffi.dart`：stickontopchange = 34
- [x] T002 `tags.json` + `sticky-header` / `sticky-section`（vue-global.d.ts
  补 `FjsStickyHeaderProps` / `FjsStickySectionProps` + scroll-view `type` prop）

## Web 端

- [x] T010 `web/components/sticky.ts`：FjsStickyHeader / FjsStickySection + stickontopchange
- [x] T011 `web/components/index.ts` 注册、`base-css.ts` 默认样式

## Flutter 端

- [x] T020 `widgets/sticky.dart`：`fjsStickySplit`（PinnedHeaderSliver +
  SliverMainAxisGroup，直接 header 按组边界互推）
- [x] T021 `scroll_view.dart`：`slivers` 参数 + `_probeSticky` 事件
- [x] T022 `node_adapters.dart`：scroll-view 分流 + 两个 sticky adapter

## mp 编译

- [x] T030 `wxml.ts`：type=custom 不注入/不包裹/根不降级（skyline）
- [x] T031 webview 降级（resolveTag + css.ts 类样式 + offset-top 映射）+
  `wx/events.ts` 的 `sticky-header:stickontopchange` 载荷适配（JSON 串）

## demo 与测试

- [x] T040 `examples/hello-fjs/src/pages/comp/sticky.vue`
- [x] T041 `mp-compiler.test.ts`：custom 三条 + webview 降级
- [x] T042 `web-sticky.test.ts`：挂载 / top / 事件翻转（含滚动容器在页面
  中部的回归用例）
- [x] T043 `flutter_fjs/test/sticky_test.dart`：sliver 路由 / 吸顶翻转 /
  互推 / 组边界离场

## 文档

- [x] T050 `docs/ui-api.md`、`docs/css-compat.md`、`docs/miniprogram.md`

## 验收

- [x] T060 `pnpm run typecheck` + `pnpm test`（70 个测试文件全过）
- [x] T061 `pnpm --filter hello-fjs run build:pages` / `build:mp`
- [x] T062 `cd packages/flutter_fjs && flutter test`（341 过）
- [x] T063 web 浏览器目验：分组头吸顶/离场、事件面板翻转、CSS sticky 块
- [x] T064 iOS 模拟器目验：fjs-go 连 `fjs dev :38901`，D 组头钉住 +
    事件面板 true/false 翻转
- [x] T065 微信开发者工具目验（skyline）：页面渲染正常、组件树含
    5×sticky-header / 4×sticky-section、事件面板收到 JSON 载荷
    （原生 skyline 的滚动拖动无法用 automator / 合成手势驱动，
    吸顶的最终拖动手感留待人工确认；另实测 skyline 首帧对每个
    header 派一次初始 `false`，已登记为文档差异）
