# Tasks: 表单组件补齐（radio / radio-group / checkbox-group / label / form）

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 在 `packages/fjs-runtime/src/ui/element.ts` 的 `EventType` 加 `onFocus: 20` / `onBlur: 21` / `onFormSubmit: 22` / `onFormReset: 23`。
- [x] T002 在 `packages/flutter_fjs/lib/src/ffi.dart` 的 `FjsEvent` 加对应四个常量，注释写清载荷形状。
- [x] T003 在 `packages/flutter_fjs/native/include/fjs.h` 的 `FJS_EVENT_*` 枚举补 20-23（C++ 不解释事件号，不需重编 native；这里是这条边界唯一的文档）。
- [x] T004 在 `packages/fjs-runtime/src/tags.json` 加 `radio` / `radio-group` / `checkbox-group` / `label` / `form` 五个标签。
- [x] T005 在 `packages/fjs-runtime/src/vue-global.d.ts` 补类型：新增 `FjsRadioProps` / `FjsGroupProps` / `FjsLabelProps` / `FjsFormProps`，扩 `FjsButtonProps`（type/size/plain/loading/disabled/formType）与 `FjsInputProps`（maxlength/onFocus/onBlur），并在 `FjsGlobalComponents` 与 `declare module 'vue'` 两处各登记 kebab 与 Pascal 两个名字。
- [x] T006 在 `packages/fjs-runtime/src/vue/renderer.ts` 把 `H` 表里的 `form` / `label` 改成映射到新标签自己（`form: { tag: 'form' }`、`label: { tag: 'label', style: { margin:4, fontSize:14, color:'#666666' } }`），默认样式经样式引擎照旧下发两端。见 plan §3.5 实施修正。
- [x] T007 在 `packages/fjs-runtime/src/vue/renderer.ts` 让 `HTML_EVENT_ALIASES` 的 `onSubmit` 按 tag 分流（`form` → `onFormSubmit`，`input` → 现有 `onSubmit`），并加 `onReset` → `onFormReset`。

## 实现（Dart 侧）

- [x] T010 新增 `packages/flutter_fjs/lib/src/widgets/control_scope.dart`：`FjsControlHandle`（nodeId / name / kind / getValue / toggle / focus）、`FjsControlScope` InheritedWidget、向父作用域转发注册的注销安全实现。注释写明「为什么是作用域注册而不是遍历镜像树」。
- [x] T011 新增 `packages/flutter_fjs/lib/src/widgets/radio.dart`：自绘圆形控件（不用 Material `Radio`，避免 40px 点击区），选中态 `#007AFF`，未选中 2px `#B0B0B0` 描边，尺寸与 `.fjs-checkbox` 同源。
- [x] T012 新增 `packages/flutter_fjs/lib/src/widgets/group.dart`：`radio-group` 互斥（选中项外全部置 false）与 `checkbox-group` 多选，按 plan §3.3 的载荷派发 `FjsEvent.valueChanged`；`name` 缺失时 `warnOnce`。
- [x] T013 新增 `packages/flutter_fjs/lib/src/widgets/label.dart`：`for` → 匹配 `id`，否则取子树第一个控件；对 checkbox/radio/switch 是切换、对 input 是聚焦；**无子节点时渲染自己的 `node.text`**（照 `button.dart` 的写法）；找不到目标时 `warnOnce`。
- [x] T014 ~~新增 `widgets/form.dart`~~ → **改为 JS 侧实现**：`packages/fjs-runtime/src/components/form.ts`（Flutter 路径的 Vue 组件）+ `ui/element.ts` 的字段账 + `vue-plugin.ts` 的原生标签排除。理由与坑见 plan §3.8。Dart 侧的 form 实现已删除。
- [x] T015 改 `packages/flutter_fjs/lib/src/widgets/button.dart`：`type`（default/primary/warn）、`size`（default/mini）、`plain`、`loading`、显式 `disabled`、`form-type`；按 plan §3.6 的取值表；按下态沿用现有 WeUI 10% 黑遮罩；disabled / loading 时不派发 tap、不出按下态。
- [x] T016 改 `packages/flutter_fjs/lib/src/widgets/input.dart`：`FocusNode` 派发 20/21（载荷是当前文本）、`LengthLimitingTextInputFormatter` 接 `maxlength`（-1 不限）、`keyboard` → `keyboardType`（补上只有 Web 有的那处），并注册进控件作用域。
- [x] T017 改 `packages/flutter_fjs/lib/src/widgets/{checkbox,switch,slider}.dart`：注册进控件作用域（`name` + `getValue` + `toggle`），`checkbox` 的 `name` 是新增可选 prop，独立用法行为不变。
- [x] T018 在 `packages/flutter_fjs/lib/src/node/node_adapters.dart` 注册五个新 adapter 到 `builtInNodeAdapters`。

## 两端对齐

- [x] T020 新增 `packages/fjs-runtime/src/web/components/scope.ts`：与 Dart 侧同形的 provide/inject 注册表，含 `parent` 链与注销。
- [x] T021 在 `packages/fjs-runtime/src/web/components/form.ts` 新增 `FjsRadio` / `FjsRadioGroup` / `FjsCheckboxGroup` / `FjsForm` / `FjsLabel`；label 渲染成普通容器 + JS 转发（**不用原生 `<label>`**，理由见 plan §3.5）。
- [x] T022 在 `packages/fjs-runtime/src/web/components/form.ts` 给 `FjsInput` 加 `maxlength` / `focus` / `blur`，给 `FjsCheckbox` / `FjsSwitch` / `FjsSlider` 加作用域注册与可选 `name`。
- [x] T023 在 `packages/fjs-runtime/src/web/components/basic.ts` 给 `FjsButton` 加 `type` / `size` / `plain` / `loading` / `disabled` / `formType`。
- [x] T024 在 `packages/fjs-runtime/src/web/components/index.ts` 的 `fjsComponents` 注册五个新组件。
- [x] T025 在 `packages/fjs-runtime/src/web/base-css.ts` 加 `.fjs-radio`、`.fjs-button--primary/warn/plain/mini`、loading 转圈动画、`label` / `form` 的默认盒模型；数值与 Dart 侧逐个相同。
- [x] T026 两端对拍事件载荷：组的 `""` / `name` / JSON 数组串、form 的 JSON 对象串（含键序）、input 的 focus/blur 文本 —— 逐字节相同。

## 测试

- [x] T030 新增 `packages/fjs-runtime/test/web-form.test.ts`：组载荷编码（含空选、顺序）、label 转发（`for` 与子树两条路径）、form 收集（含未改动字段的默认值）、maxlength 截断。
- [x] T031 新增 `packages/flutter_fjs/test/form_controls_test.dart`：与 T030 同样四项的 Dart 侧对拍，断言完整载荷字符串。
- [x] T032 补 `<label>文字</label>` 无子节点时文字仍渲染的用例，两端各一条（plan §4 风险 3）。
- [x] T033 补 button 的 disabled 语义用例：「挂了 onTap + disabled」不派发；「没挂 onTap」仍是静态外观而不是变淡（plan §4 风险 4）。
- [x] T034 新增 `examples/hello-fjs/src/pages/comp/radio.vue`（radio / radio-group / checkbox-group / label），`<route>` 的 `group` 为 `表单组件`。
- [x] T035 新增 `examples/hello-fjs/src/pages/comp/form.vue`（form 提交/重置 + button 六种形态 + input 的 focus/blur/maxlength），`group` 同上。
- [x] T036 Web 验证：`pnpm --filter hello-fjs run dev:web`，逐条走 spec §6.6 的对照项。
- [x] T037 iOS 模拟器验证：`pnpm --filter hello-fjs run run:ios`，同一份对照项；重点走 blur 的三条路径（键盘收起 / 路由切换 / 页面销毁）只派发一次。**Android 不测**。

## 文档

- [x] T040 更新 `docs/ui-api.md`：标签表加 5 行，事件表加 20-23，button / input 的新 props。
- [x] T041 更新 `docs/css-compat.md`：`<label>` 不再映射成 `text`、`<form>` 不再映射成 `view`，说明新行为与保留的默认样式。
- [x] T042 更新 `docs/web.md`：登记 loading 转圈的两端视觉差异（Material 转圈 vs CSS 动画）。
- [x] T043 更新 `docs/roadmap.md`：表单组件这一组打勾，并注明 picker / picker-view / editor 顺延到下一个 spec。

## 验收

- [x] T050 `pnpm run typecheck`
- [x] T051 `pnpm test`
- [x] T052 `pnpm --filter hello-fjs run typecheck`
- [x] T053 native 已编，`flutter test` 跑完 165 项：本 spec 相关的全过；`nav_router_test.dart` 的「popping waits for the route transition before JS unmount」失败，**在本分支改动前的 main 上同样失败**（已 stash 验证），与本 spec 无关。
- [x] T054 spec.md 第 6 节逐条核对
