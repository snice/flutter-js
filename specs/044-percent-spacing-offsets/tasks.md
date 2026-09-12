# Tasks: 百分比扩展到盒模型间距与定位偏移

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层

- [x] T001 确认零协议改动：op 协议 / natives / 事件三张表不动；JS 侧与
  web 适配层零改动（`rewriteFjsCss` 对 `10%` 无作用，既有测试守门）。

## 实现（Dart）

- [x] T010 `render/style.dart`：`_edgeLengths`（`parseFjsLength` 分量 +
  长手覆盖）、`paddingLengths` / `marginLengths`、`hasRelativeSpacing`；
  `leftLength`/`topLength`/`rightLength`/`bottomLength`、
  `hasRelativeOffset`；现有 EdgeInsets getter 与行为不变。
- [x] T011 `render/decoration.dart`：padding / margin / relativeOffset 三处
  相对分支（LayoutBuilder 按入参约束解析，无界按 0；绝对边与
  `defaultPadding` 语义不变；无相对边走原路径）。
- [x] T012 `render/flex.dart`：`_flexChild` 主轴门扩展（横向间距/左右偏移、
  纵向上下偏移）；`_wrapChild` 同门；`positionedChild` 的 `relative` 门
  与 left/right/top/bottom 的按轴解析。

## 测试

- [x] T020 `style_edge_test.dart`：edge 长度解析（简写/长手优先级/calc）、
  门标志。
- [x] T021 `percent_in_flex_test.dart`：row 子项 % margin 跟随容器宽
  （含上界传递路径）、column 子项 % padding 参照宽。
- [x] T022 `position_test.dart`：absolute top/left % 解析、relative
  left % 偏移、无界参照按 0。
- [x] T023 widget 测试：两种窗口宽度下 `%` padding 解析结果不同。

## 两端对齐

- [x] T030 `examples/hello-fjs/src/pages/example/percent-spacing.vue`：
  四个面板（流式 padding / % margin / relative left 50% / absolute 居中），
  typecheck + build。
- [x] T031 web 侧 `vite build` 产物核对（% 声明原样存活）+ 内嵌浏览器
  实测（窄屏 390 四面板正确）；iOS 模拟器实测四面板与 web 逐项一致。

## 文档

- [x] T040 `docs/css-compat.md`：单位表 `%` 行扩为「尺寸 + 盒模型间距 +
  定位偏移」，登记参照轴与不生效的消费点（input contentPadding、text
  路径、gap/border-radius/font-size 顺延）。
- [x] T041 `docs/roadmap.md` 近期计划勾选。

## 验收

- [x] T050 `pnpm run typecheck` && `pnpm test`
- [x] T051 `cd packages/flutter_fjs && flutter test`（全量）
- [x] T052 spec.md 第 6 节逐条核对（实机项可挂起，注明）。
