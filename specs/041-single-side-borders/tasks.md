# Tasks: 单边边框

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层

- [x] T001 确认零协议改动：op 协议 / natives / 事件三张表不动；JS 生产代码不动。

## 实现（Dart）

- [x] T010 `render/style_parse.dart`：`parseBorder`（原 `_parseBorderUncached`）与
  `parseBorderStyle` 可从 style.dart 复用（导出/包装）。
- [x] T011 `render/style.dart`：`FjsBoxBorders`（四边可空记录 + isUniform /
  isNone / hasDashed）与 `FjsStyle.boxBorders({Color? defaultBorderColor})`
  每边级联解析；`hasBorderDeclaration` 纳入单边键。
- [x] T012 `render/dashed_border.dart`：抽出 `strokeDashes` 助手；新增
  `FjsSideBorderPainter`（每边分段路径、半角弧归属、逐边宽度/颜色/kind）。
- [x] T013 `render/decoration.dart`：三条绘制路径选择 + 逐边 padding 占位 +
  默认 hairline 逐边补。
- [x] T014 `widgets/text.dart` 行内片段警告纳入单边键；核对 `widgets/button.dart`
  的默认描边路径。

## 测试

- [x] T020 `flutter_fjs/test/`：解析级联单测（长手>单边简写>全局长手>全局简写、
  none/0 宽、仅色推 1px、默认逐边补）。
- [x] T021 widget 测试：无圆角非均匀 → per-side Border；圆角+一致 → Border.all
  不回归；圆角+非均匀 → painter + 占位；button `border-bottom: none` 共存。
- [x] T022 painter 几何单测：sidePath 分段长度/端点；既有 dashed 测试不回归。
- [x] T023 `fjs-runtime/test/css.test.ts`：`border-bottom` 等键透传断言。

## 两端对齐

- [x] T030 `examples/hello-fjs/src/pages/example/pseudo.vue` 新增「单边边框」
  面板，更新 040 时期的注释；typecheck + build。
- [x] T031 浏览器（dev:web）已实测：srow 分隔线 / :last-child 关掉 / accent 圆角+单边全部正确；iOS 模拟器复验待做（host 需重新构建）。
- [x] T031b iOS 模拟器复验（用户重启 `fjs run ios` 后看「单边边框」面板）。

## 文档

- [x] T040 `docs/css-compat.md` 边框表 ❌→✅（含源顺序差异）；`docs/ui-api.md`
  核对；`docs/roadmap.md` 041 条目。

## 验收

- [x] T050 `pnpm run typecheck` / `pnpm test`
- [x] T051 `cd packages/flutter_fjs && flutter test`（全量，先编 native）
- [x] T052 spec.md §6 逐条核对 done
