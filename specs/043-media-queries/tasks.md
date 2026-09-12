# Tasks: @media 响应式样式

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 `packages/flutter_fjs/native/include/fjs.h`：加
  `FJS_EVENT_VIEWPORT_CHANGED = 33` 枚举 + 载荷注释（`{"width":n,"height":n}`
  逻辑像素，一位小数）；重编 native（`cmake --build build-native`）并跑
  `fjs-test` 确认无回归。
- [x] T002 `packages/flutter_fjs/lib/src/ffi.dart`：`FjsEvent.viewportChanged = 33`
  + 注释（与 fjs.h 对齐）。
- [x] T003 `packages/fjs-runtime/src/vue/renderer.ts`：模块加载时
  `registerSystemHandler(33, …)`，解析 JSON 载荷调 `styleEngine.setViewport`；
  有原生宿主时再 `invokeHost('fjs.viewport.get')` 拉一次初始尺寸（时序
  修正见 plan §3，web / fjsrun 跳过）。

## 实现

- [x] T010 `packages/fjs-runtime/src/css/parser.ts`：`MediaCondition` 类型 +
  条件解析（type screen/all、`only` 吞掉、min/max-width·height、width/height、
  orientation、`and` 与逗号；`not`/未知特性/非法值 warnOnce 整块弃）；
  `parseStylesheet` 遇 `@media` 递归解析块内规则集，规则挂 `media`；嵌套
  at-rule warnOnce 跳过；无 media 的规则不带该键。
- [x] T011 `packages/fjs-runtime/src/css/style.ts`：`setViewport(w, h)`
  （等值快速路径、`hasMedia` 门、复用 `register()` 的失效路径）、回退尺寸
  390×844 常量 + 注释、`matchRules` 按 `rule.media` 过滤、`register()` 识
  别 media 规则置 `hasMedia`。
- [x] T012 `packages/flutter_fjs/lib/src/engine.dart`：`updateViewport(Size)`
  ——载荷串一位小数、按串去重、VM 未起存 pending；`host.register('fjs.viewport.get')`
  返回当前尺寸 JSON（初始拉取端，natives 零改动）。
- [x] T013 `packages/flutter_fjs/lib/src/fjs_view.dart`：`_FjsViewState` 实现
  `WidgetsBindingObserver`，`didChangeDependencies` 推 `MediaQuery.sizeOf`、
  `didChangeMetrics` 帧后重推、`dispose` 移除。

## 两端对齐

- [x] T014 Web 侧确认零生产改动：`rewriteFjsCss` 对 media 块的行为写进
  `packages/fjs-runtime/src/web/css-compat.test.ts` 回归用例（块内无单位
  长度补 px、块内 `flex-grow` 改写、`(min-width: 600)` 补 px、
  `(orientation: portrait)` 不被改），plan §4 的误伤风险在此钉死。
- [x] T015 `examples/hello-fjs/src/pages/example/responsive.vue`：
  spec §3 的侧栏形态（`min-width: 600px` 断点）+ 一个 `orientation` 用例 +
  一个 `@media print` 告警演示；typecheck + build 通过。

## 测试

- [x] T020 `fjs-runtime/test/css.test.ts`（或新建 media 专用测试文件）：
  条件解析用例（合法 / 逗号 / and / only / 非法 warnOnce）、规则挂
  `media`、无 media 规则形状不变。
- [x] T021 StyleEngine 用例：`setViewport` 前后匹配翻转、重算触发
  applyStyle spy、回退尺寸下 `min-width: 600` 不命中、`hasMedia` 为假时
  `setViewport` 零成本（不清缓存）。
- [x] T022 Dart 测试：engine 载荷去重与 VM 重建后补发（单测）；widget 测试
  ——test bundle 带 media 规则，`tester.view` 两种尺寸 pump，断言样式分支
  变化（先编 native，注意 `No tests ran` 陷阱）。

## 文档

- [x] T030 `docs/css-compat.md`：选择器表 `@media` ❌→✅、新增 media 小节
  （支持语法、参照物、fjsrun 回退）、已知差异登记（web 原生是超集）。
- [x] T031 `docs/ui-api.md` 样式清单核对；`docs/roadmap.md` 近期计划
  CSS 扩展条目标注 @media 完成（百分比尺寸 / transition 留下）。

## 验收

- [x] T040 `pnpm run typecheck` && `pnpm test`（605 条全过，含新增 24 条
  parser/engine/rewrite 用例）
- [x] T041 native `fjs-test` ALL PASS；`flutter test` 全量 313 条通过
  （含新增 viewport_test 3 条）
- [x] T042 对拍：web 侧 `vite build` 产物里四个 media 块全部存活
  （scoped 属性、`flex-grow:1`→`flex:1`、组合条件、print 块）；内嵌浏览器
  实测 390/800 两档断点正确。iOS 模拟器实测：竖屏（402pt）无侧栏、灰底，
  Cmd+→ 转横屏后**侧栏即时出现**、蓝底、组合条件命中——事件 33 通道
  端到端工作，与 web 逐项一致。`fjsrun` 跑 hello-fjs bundle 在 main 上
  同样是存量失败（与本 spec 无关，回退尺寸由引擎单测覆盖）。
- [x] T043 spec.md 第 6 节逐条核对：全部通过（§6.3/§6.4 的模拟器项已于
  044 会话补验）。
