# Tasks: 选择器 picker / picker-view / picker-view-column

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 确认本需求不修改三张契约表：`packages/fjs-runtime/src/ui/ops.ts` + `packages/flutter_fjs/lib/src/ui_ops.dart`、`packages/fjs-runtime/src/native-global.d.ts` + `packages/flutter_fjs/native/src/natives.cpp`、`packages/fjs-runtime/src/ui/element.ts` + `packages/flutter_fjs/native/include/fjs.h`。`picker-view` 复用 `valueChanged`(5)，`picker` 的事件不过桥。
- [x] T002 在 `packages/fjs-runtime/src/tags.json` 加 `picker-view` / `picker-view-column`（`picker` **不加**：它是组件不是标签）。
- [x] T003 在 `packages/fjs/src/bundler/vue-plugin.ts` 的 `FLUTTER_COMPONENT_TAGS` 加 `picker`；确认排除判断仍在 `isHTMLTag` 之前。
- [x] T004 在 `packages/fjs-runtime/src/vue-global.d.ts` 补 `FjsPickerProps` / `FjsPickerViewProps` / `FjsPickerViewColumnProps`，在 `FjsGlobalComponents` 与 `declare module 'vue'` 两处各登记 kebab 与 Pascal 名。

## 实现

### modal 先测后改（plan §3.2，本 spec 唯一动到既有能力的地方）

- [x] T010 新增 `packages/flutter_fjs/test/modal_live_test.dart`，锁住现有行为。**写的时候纠正了一处我自己的错误预期**：JS 自己把 `visible` 置回 false 时**不派** `onModalClosed`（JS 已经知道），只有原生手势关闭才回派——测试按真实契约写。
- [x] T011 改 `packages/flutter_fjs/lib/src/widgets/modal.dart`：sheet 内容从「打开那刻建好的 widget 列表」改成 `ListenableBuilder(tree.listenableFor(node.id))` 包 `FjsNodeRenderer(tree:, ids: node.children, dispatch:, registry:)`；`FjsModal` 增加 `tree` / `registry` 参数，`node_adapters.dart` 的 modal adapter 跟着传。注释记清代价（sheet 内容每帧可能重建）。
- [x] T012 在 `modal_live_test.dart` 补新行为用例：打开期间增删子节点，sheet 里跟着变。

### 纯函数层

- [x] T013 新增 `packages/fjs-runtime/src/components/picker-modes.ts`：`range` / `range-key` 摊平成字符串列表、`time` 与 `date` 的列生成与 `start`/`end` 裁剪、`fields` 粒度、下标 ↔ 值互转、越界取末项。不依赖 Vue。
- [x] T014 新增 `packages/fjs-runtime/test/picker-modes.test.ts`：日期数学（闰年 2 月、月末、`start`/`end` 同月）、`fields=year|month|day`、`range-key`、越界 `value`、`time` 范围裁剪。

### 滚轮（Dart）

- [x] T015 新增 `packages/flutter_fjs/lib/src/widgets/picker_view.dart`：每列一个 `ListWheelScrollView` + `FixedExtentScrollController`，`itemExtent` 44、`diameterRatio` 100（压平，理由写注释）、可见 5 行、居中选中框 + 上下 88px 蒙层渐隐；`onSelectedItemChanged` 静止后按 plan §3.3 派发；非 `picker-view-column` 子节点 `warnOnce` 且不渲染。
- [x] T016 在 `packages/flutter_fjs/lib/src/node/node_adapters.dart` 注册 `picker-view` / `picker-view-column` 两个 adapter；`picker-view` 无显式高度时给默认 220（plan §4 风险 6）。
- [x] T017 处理 `value` 与控制器的双向同步（plan §4 风险 2）：仅当目标下标与当前项不同才 `animateToItem`，回派事件时不写回自己的 `value`；列数变化时重建控制器（风险 5）。

### picker 组件（全 JS）

- [x] T018 新增 `packages/fjs-runtime/src/components/picker.ts`：插槽内容包一层收 `@tap`，`disabled` 时不弹；渲染 `modal` + 取消/确定 `button` + `picker-view`；四种 mode 走 `picker-modes.ts`。
- [x] T019 在 `packages/fjs-runtime/src/app/flutter.ts` 注册 `app.component('picker', FjsPicker)`（照 `list-view` / `form`）。
- [x] T020 实现 `multiSelector` 的联动：某列停下先派 `@columnchange`（载荷 `{"column":0,"value":2}`），页面改 `range` 后重算其余列——依赖 T011 的活内容。
- [x] T021 `mode` 不认识、`date`/`time` 的 `value` 不合格式或超出 `start`/`end` 时 `warnOnce` 并钳制到边界（宪法 V）。

## 两端对齐

- [x] T030 新增 `packages/fjs-runtime/src/web/components/picker-view.ts`：flex 行，每列 `scroll-snap-type: y mandatory`，`scrollend` 派发、老 Safari 用 150ms 防抖兜底（plan §3.5）。
- [x] T031 在 `packages/fjs-runtime/src/web/components/index.ts` 注册 `picker-view` / `picker-view-column`，并确认 web 侧同样能解析到 `picker` 组件。
- [x] T032 在 `packages/fjs-runtime/src/web/base-css.ts` 加两端同值的几何：行高 44、容器 220、选中框 1px `#E5E5EA`、上下 88px 蒙层渐隐（plan §3.4 的表）。
- [x] T033 两端对拍事件载荷：`picker-view` 的下标数组 JSON 串、`picker` 各 mode 的 `@change`（`"2"` / `[1,0,3]` / `"09:30"` / `"2026-09-04"`）、`@columnchange` 的对象串 —— 逐字节相同。

## 测试

- [x] T040 新增 `packages/flutter_fjs/test/picker_view_test.dart`：列渲染、`value` 驱动滚动、静止后只派一次、非 column 子节点 warnOnce、无高度时用默认 220。
- [x] T041 新增 `packages/fjs-runtime/test/picker.test.ts`：点插槽弹层、确定派 `@change`、取消派 `@cancel` 且不改值、`disabled` 不弹、`columnchange` 载荷。
- [x] T042 补一条两端 change 次数一致的用例（plan §4 风险 3）：连续快速滚动只应各派一次。
- [x] T043 新增 `examples/hello-fjs/src/pages/comp/picker.vue`（四种 mode），`<route>` 的 `group` 为 `表单组件`。
- [x] T044 新增 `examples/hello-fjs/src/pages/comp/picker-view.vue`（内嵌滚轮 + 联动列），`group` 同上。
- [x] T045 Web 验证：`pnpm --filter hello-fjs run dev:web`，逐条走 spec §6.6 的对照项，外加既有 `comp/modal.vue` 的人工回归（plan §4 风险 1）。
- [x] T046 iOS 模拟器验证。过程中修掉三处只在设备上暴露的问题：① `FjsNodeRenderer` 按页面根语义给子节点 `Expanded`，在 sheet 的无界高度里触发布局断言 → 新增 `grow` 开关；② `.fjs-picker-bar` 只在 web base-css 里有，Flutter 侧按钮竖排 → 布局改成组件内联样式；③ Flutter 侧缺上下渐隐 → 补 `ShaderMask`；④ 弹层本身两端不像：Flutter 吃的是 Material 主题的 surface 色 + M3 的 28 圆角、无内边距，web 是 `.fjs-modal-sheet` 的白底 / 12 圆角 / 16 内边距 → `modal.dart` 显式取同一组值（`fjsModalSheetBackground` / `Radius` / `padding`）。**Android 不测**。

## 文档

- [x] T050 更新 `docs/ui-api.md`：标签表加 `picker-view` / `picker-view-column`，新增 `picker` 的 mode 表；**改掉 modal 那行的「打开期间内容为快照」**。
- [x] T051 更新 `docs/web.md`：登记 iOS 滚轮触感、以及 `scrollend` 与防抖兜底的实现差异。
- [x] T052 更新 `docs/roadmap.md`：picker 这一组打勾，注明 `region` 与 `editor` 顺延及理由。

## 验收

- [x] T060 `pnpm run typecheck`
- [x] T061 `pnpm test`
- [x] T062 `pnpm --filter hello-fjs run typecheck`
- [x] T063 native 已重编，`flutter test` 跑出 178 通过 / 3 跳过 / 1 失败——失败的仍是既有的 `nav_router_test`「popping waits for the route transition before JS unmount」，与本 spec 无关。
- [x] T064 spec.md 第 6 节逐条核对（除 T046/T063 的 iOS/native 路径，按用户要求暂不继续）
