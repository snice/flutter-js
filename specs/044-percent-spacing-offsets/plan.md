# Plan: 百分比扩展到盒模型间距与定位偏移

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | 参照轴按 CSS 标准（padding/margin 全边参照父盒宽，left/right 参照宽、top/bottom 参照高，无界退化为 0/auto），web 是真 CSS 本来就是这个语义，**web 与 JS 零改动**；App 端补齐后两端一致。App 侧参照物是「传到节点的约束上界」，row flex 主轴经 `_flexChild` 传容器宽上界（既有 `width: 50%` 同一机制），与 CSS 一致 |
| II 边界即契约 | 否 | op 协议 / natives / 事件三张表零改动——`%`/`calc()` 本来就以字符串在 merged style map 里传输，Dart 侧只是开始读它们 |
| III 同步单线程零序列化 | 否 | 无新通道 |
| IV 外观照 WeUI | 否 | 不改任何默认外观 |
| V 静默失效是 bug | 是 | 现状是「App 静默丢、web 生效」的分叉，本 spec 消除分叉；不支持的场景（布局前就要数的消费点）维持现状并在文档登记 |
| VI 注释记录权衡 | 是 | `hasRelativeSpacing` 门、无界参照按 0 的 CSS 依据、`_flexChild` 门扩展的 why，都写在代码里 |
| VII JS 能包就不要下 Dart | 是 | 本 spec 的能力只能落 Dart——布局期才知道约束上界，JS 侧根本没有布局信息；Dart 侧也只做「把字符串解析成 FjsLength 后按约束解析」一件 JS 做不到的事 |
| VIII 变更落到文档 | 是 | `docs/css-compat.md`（单位表 + 盒模型「百分比尺寸」行）、`docs/roadmap.md` |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| JS runtime | 无 | 零改动（`%`/`calc()` 字符串透传，web 真 CSS） |
| Dart 渲染 | `packages/flutter_fjs/lib/src/render/style.dart` | `_edgeLengths(key)`（简写四分量 `parseFjsLength` + 长手覆盖，与现有 `_edge` 同一优先级）、`paddingLengths` / `marginLengths`、`hasRelativeSpacing`；`leftLength`/`topLength`/`rightLength`/`bottomLength` + `hasRelativeOffset`；现有 EdgeInsets getter 不动（绝对值消费点继续用） |
| Dart 渲染 | `packages/flutter_fjs/lib/src/render/decoration.dart` | padding/margin/relativeOffset 三处：存在相对边时各自走 `LayoutBuilder` 解析（相对边按入参约束解析、无界按 0，绝对边与 `defaultPadding` 语义不变）；无相对边走原路径零开销 |
| Dart 渲染 | `packages/flutter_fjs/lib/src/render/flex.dart` | `_flexChild` 主轴门扩展（横向：有相对间距或相对 left/right 的子项也传容器宽上界；纵向：有相对 top/bottom 的传高上界）；Wrap 分支 `_wrapChild` 同门；`positionedChild` 的 `relative` 门扩展 + 偏移按 `outer.maxWidth`/`maxHeight` 解析 |
| 测试 | `packages/flutter_fjs/test/percent_in_flex_test.dart`、`position_test.dart`、`style_edge_test.dart`（或新增） | 见 §5 验证路径 |
| 示例 | `examples/hello-fjs/src/pages/example/percent-spacing.vue` | spec §3 的四个用例面板 |
| 文档 | `docs/css-compat.md`、`docs/roadmap.md` | 单位表 ❌ 行改 ✅（登记参照轴与消费点边界）、roadmap 勾选 |

CLI / 构建层、C++、JS runtime、web 适配层均不动。

## 3. 方案

**解析层**：`style.dart` 的 `_edge` 已经定义了「简写 + 长手，长手覆盖」的
合并语义，但每边只出 `double?`。加一条并行的 `_edgeLengths` 路径：分量用
`parseFjsLength`（'8px' / '8' / '10%' / `calc(100% - 32px)` 统一进
`FjsLength`），输出每边可空的 `FjsLength`。现有 `padding`/`margin`
（EdgeInsets）getter 原样保留——`input` 的 contentPadding、text 路径等
绝对值消费点继续走它，行为不变。

**渲染层**：`decoration.dart` 已有两个「有相对值才包 LayoutBuilder」的
先例（width/height、constraints），照同一形状加分支：

- padding：`paddingLengths` 有相对边 → LayoutBuilder，每边
  `resolveOrNull(constraints.maxWidth)`，null（无界）按 0；该边没有
  声明 → 落到绝对值或 `defaultPadding`（`button` 的默认内边距语义不变）。
- margin：同上，无默认值，位于最外层（不进食盒宽，CSS 语义不变）。
- relativeOffset：`hasRelativeOffset` → LayoutBuilder，dx 参照
  `maxWidth`、dy 参照 `maxHeight`，无界按 0。

**flex 约束传递**：CSS 的 % 参照父内容盒，而 Flutter 的 Flex 给子项无界
主轴。`_flexChild` 已经为「相对主轴尺寸」的子项把容器上界传下去
（`ConstrainedBox(maxWidth: mainAxisMax)`），把门扩到：

- 横向（row）：相对主轴尺寸 ∪ 相对间距（%  padding/margin 参照宽）∪
  相对 left/right；
- 纵向（column）：相对主轴尺寸 ∪ 相对 top/bottom（% padding 参照的宽是
  交叉轴，Flex 交叉轴本来就给有界约束，无需传）。

Wrap 分支已有 `mainAxisMax`（LayoutBuilder 包着），`_wrapChild` 加同门。
`positionedChild` 的 `relative` 门（是否需要外层 LayoutBuilder）加入
相对偏移；解析处把 left/right 参照 `outer.maxWidth`、top/bottom 参照
`outer.maxHeight`——与既有 `width/height` 的参照同一只 `outer`。

**否掉的备选**：

1. **在 JS 引擎里按「父宽度已知时」预解析 %**：JS 侧没有布局，父盒宽度
   只有 Flutter 布局期才知道；预解析等于把布局搬到 JS，破坏宪法 III。
2. **padding/margin 解析用 `LayoutBuilder` 全量包裹**：只在
   `hasRelativeSpacing` 时才包——绝大多数节点零开销，与
   `hasRelativeConstraints` 门的既有取舍一致。
3. **把 gap / border-radius / font-size 一起做**：三者参照机制各不相同
   （gap 沿轴参照内容盒、radius 参照自身盒、font-size 参照父字号），
   一个 spec 塞三个语义只会让对拍变糊，roadmap 的措辞也是「padding/
   margin/top 等」，顺延。
4. **相对边无界时告警**：无界退化是 CSS 标准行为（列表里 `padding: 5%`
   按没写处理），不是错误，告警反而变成噪音；css-compat 登记即可。

## 4. 风险

- **参照轴与直觉不符**（`padding-top: 10%` 参照宽度不是高度）：这是 CSS
  标准，文档写明，对拍时两端一致即可。
- **`_flexChild` 门扩展改变既有布局**：传 `maxWidth` 上界是宽松约束
  （上界不是紧约束），不声明尺寸的子项仍收缩——与既有 `width: 50%`
  门同款，风险低；用 percent_in_flex 既有测试守门。
- **decoration 分支叠加**：width/height 相对 + 间距相对会叠两个
  LayoutBuilder——与既有 constraints 门的叠加方式一致，先照旧，实测有
  开销再合并。
- **text 路径的 margin/padding**：`text.dart` 用绝对值 getter，`%` 在
  text 上仍按没写处理——登记进 css-compat（与 input contentPadding 同款）。

## 5. 验证路径

```bash
# JS 侧（应零改动不回归）
pnpm run typecheck && pnpm test

# Dart 侧
cd packages/flutter_fjs
cmake --build build-native -j   # native 无改动，例行确认
flutter test                    # 全量 + 新增用例

# 两端对拍
pnpm --filter hello-fjs run build:web   # 产物含 % 声明原样
fjs dev --web                            # 拖窗：留白随宽度伸缩
fjs run ios                              # 转屏/拖窗对拍（可挂起）
```

新增用例清单：
- `style_edge_test`：`padding: '0 4%'` → 左右 `FjsLength(percent: .04)`、
  上下 null；长手 `padding-left: 10%` 覆盖简写；`calc(50% - 8px)` 进
  `FjsLength`；`hasRelativeSpacing` / `hasRelativeOffset` 门。
- `percent_in_flex_test`：row 子项 `%` margin 在容器宽度变化时跟随
  （含 `_flexChild` 传上界的路径）；column 子项 `%` padding 参照宽。
- `position_test`：absolute `top: 50%` / `left: 50%` 在外层尺寸下的解析；
  relative `left: 50%` 的 `Transform.translate` 偏移；无界参照按 0。
- widget 测试：同一页面两种窗口宽度 pump，`%` padding 的盒子内边距不同。
