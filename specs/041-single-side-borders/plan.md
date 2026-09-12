# Plan: 单边边框 — `border-top/right/bottom/left`

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 涉及 | web 是真 CSS 原生支持（零改动）；Flutter 侧实现解析与绘制；源顺序差异登记 css-compat |
| II 边界即契约 | 不涉及 | 样式键走既有 style JSON 与状态变体通道，op 协议 / natives / 事件三张表一张不动 |
| III 同步单线程零序列化 | 不涉及 | 无新通道 |
| IV 外观照 WeUI | 涉及 | button 默认 hairline 改为**逐边**补默认：页面只声明一条边时其余边保留默认（对齐 CSS） |
| V 静默失效是 bug | 涉及 | text 片段警告条件纳入单边键；降级路径（不支持处）均告警 |
| VI 注释记录权衡 | 涉及 | painter 的角归属（相邻边各半）、非均匀宽度的描边内缩近似、合并 map 无法还原源顺序 |
| VII JS 能包就不要下 Dart | 涉及 | 绘制必须落 Dart（Flutter 渲染能力），JS 引擎零改动正是这条宪法的体现 |
| VIII 变更落到文档 | 涉及 | css-compat 边框表、ui-api 样式清单核对、roadmap |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| JS runtime | `fjs-runtime/test/css.test.ts` | 仅补键透传断言（生产代码零改动） |
| Dart 宿主 | `flutter_fjs/lib/src/render/style.dart` | `FjsBoxBorders`：每边解析（单边长手 > 单边简写 > 全局长手 > 全局简写），`none`/0 宽关单边，仅声明色/型推 1px；`hasBorderDeclaration` 纳入新键 |
| Dart 宿主 | `flutter_fjs/lib/src/render/decoration.dart` | 三条绘制路径：uniform solid → `Border.all`（现状）；无圆角非均匀 → `Border` per-side；圆角非均匀或含 dashed → 自绘 painter + 逐边 padding 占位；默认 hairline 逐边补 |
| Dart 宿主 | `flutter_fjs/lib/src/render/dashed_border.dart` | 抽出 `strokeDashes` 公共助手；新增 `FjsSideBorderPainter`（分段路径 + 半角弧归属 + 每边 dashed/dotted/solid） |
| Dart 宿主 | `flutter_fjs/lib/src/widgets/text.dart` | 行内片段警告条件纳入单边边框键 |
| 示例 | `examples/hello-fjs/src/pages/example/pseudo.vue` | 新增「单边边框」面板：`border-bottom` 分隔线 + `:last-child` 关掉 + `border-top` 卡片 + 圆角配单边；更新 040 时期"不支持"的注释 |
| 测试 | `flutter_fjs/test/` | 解析级联单测；三条绘制路径 widget 测试；button 默认描边共存；painter 几何 |
| 文档 | `docs/css-compat.md`、`docs/roadmap.md`、`docs/ui-api.md` | ❌→✅、roadmap 041 条目 |

## 3. 方案

- 每边解析放在 `FjsStyle`（`boxBorders({Color? defaultBorderColor})` 方法），
  decoration 是唯一消费方；旧 `border` getter 保留给 text 片段警告与既有测试。
- 圆角判定：`borderRadius == null || BorderRadius.zero` → 原生 `Border` per-side；
  否则非均匀/含虚线走 painter。painter 的角弧按「相邻边各半」归属（CSS 规范），
  直边各自按本边宽度内缩 w/2；宽度非一致时的角部衔接是已知近似（spec §4）。
- 被否掉的备选：非均匀+圆角降级成 uniform + 告警（用户明确要真支持）；
  JS 引擎拆解单边简写为四键（拆了反而让 Dart 丢失"简写整体声明"语义，且
  web 构建产物会多出无谓改写）。

## 4. 风险

- **三条路径静默选错**：widget 测试逐条锁定（找 BoxDecoration 的 Border 形状
  / painter 存在与否）。
- **button 默认描边共存**：`border-bottom: none` 后其余三边必须保留默认
  hairline——逐边补默认的语义变化，`widgets/button.dart` 若直接构 Border 需同步。
- 既有页面回归：demo / hello-fjs 现有 `border`、`border-color` 用法
  （`flutter test` 现有用例覆盖）。

## 5. 验证路径

```bash
cd packages/flutter_fjs && flutter test          # 全量
pnpm test                                        # JS 透传断言 + 全回归
# 对拍：hello-fjs 伪类页「单边边框」面板，dev:web 与 fjs run ios
```
