# Tasks: 样式级 position: sticky + mp webview 自定义组件

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## Flutter 端

- [ ] T010 `widgets/sticky.dart`：`fjsIsStickyNode` + top 样式→offset-top（% 告警）
- [ ] T011 `node_adapters.dart`：sliver 触发条件扩为样式识别
- [ ] T012 `render/flex.dart`：深层嵌套样式 sticky warnOnce
- [ ] T013 `sticky_test.dart` +3 例（样式吸顶 / top→pin 线 / 深层 warn）

## mp webview 组件

- [ ] T020 `fjs-sticky-header` 四件套（virtualHost + IO 测量 + 事件）
- [ ] T021 `fjs-sticky-section` 四件套
- [ ] T022 `project.ts` RUNTIME_COMPONENTS + copy 按渲染器 skip
- [ ] T023 `wxml.ts` resolveTag 分流 + genAttrs 删降级拦截 + data-tag 核对

## 测试 / demo / 文档

- [ ] T040 `mp-compiler.test.ts` webview 用例改断言自定义组件
- [ ] T041 `sticky.vue` CSS 块文案改三端生效
- [ ] T042 `docs/ui-api.md` / `css-compat.md` / `miniprogram.md`

## 验收

- [ ] T060 typecheck + pnpm test + flutter test + build:pages/build:mp
- [ ] T061 web 回归目验
- [ ] T062 iOS 模拟器目验：CSS sticky 块在 Flutter 端吸顶
- [ ] T063 devtools 切 webview 渲染器：组件挂载、滚动吸顶、事件面板
