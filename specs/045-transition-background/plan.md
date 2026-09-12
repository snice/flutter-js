# Plan: transition 过渡——登记既有支持并补背景色

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | App 补 background-color 渐变后，transform/opacity/background-color 三类过渡两端观感一致；做不到的（delay、gradient、color/border）在 css-compat 登记为两端差异；web 零改动（真 CSS 原生） |
| II 边界即契约 | 否 | 三张表零改动：`transition` 键一直是样式 map 的字符串透传 |
| III 同步单线程零序列化 | 否 | 动画在 Flutter UI isolate 内（Ticker），不碰 JS |
| IV 外观照 WeUI | 否 | 不改默认外观 |
| V 静默失效是 bug | 是 | 文档从 ❌ 改为登记真实支持范围；App 不动画的属性是「瞬时跳变」而非丢声明，差异表写明 |
| VI 注释记录权衡 | 是 | TweenAnimationBuilder 选型（无 delay 钩子 → delay 不生效，登记差异）与「零开销门」（无 track 不包 widget）写在代码里 |
| VII JS 能包就不要下 Dart | 是 | 只能下 Dart：逐帧插值是 Flutter 渲染能力；JS 侧没有帧循环参与样式（rAF 是页面级的） |
| VIII 变更落到文档 | 是 | css-compat.md（视觉效果表 ❌→✅/⚠️ + 已知差异）、ui-api.md 样式清单、roadmap 打勾 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| JS runtime | 无 | 零改动（键透传 + web 真 CSS） |
| Dart 渲染 | `packages/flutter_fjs/lib/src/render/decoration.dart` | `box()`：`background` 为实色且存在 duration > 0 的 background-color/all track 时，Container 由 `TweenAnimationBuilder<Color?>` 驱动逐帧重建；无 track 走原路径 |
| 测试 | `packages/flutter_fjs/test/`（新增 transition_background_test.dart 或并入现有） | 见 §5 |
| 示例 | `examples/hello-fjs/src/pages/example/transition.vue` | `:active` 缩放（既有能力验证）+ 背景渐变按钮 + 类切换卡片 |
| 文档 | `docs/css-compat.md`、`docs/ui-api.md`、`docs/roadmap.md` | 表格登记 + 打勾 |

## 3. 方案

**背景色动画**：`box()` 里 `decorated` 分支的 Container 拆成「参数构建」+
「是否动画」两层。命中动画条件（`style.gradient == null`、`background !=
null`、`transitions.forProperty('background-color')` 非 null 且
`duration > Duration.zero`，`forProperty` 已实现 `all` 回落）时：

```dart
TweenAnimationBuilder<Color?>(
  tween: ColorTween(end: background),
  duration: track.duration,
  curve: track.curve,
  builder: (_, color, child) => Container(..., decoration: BoxDecoration(color: color, ...), child: child),
  child: child,
)
```

`TweenAnimationBuilder` 的语义正是 CSS transition 的语义：首帧直接取值，
目标变化时从当前值插值到新目标——不需要自己记账 begin。**否掉的备选**：

1. **扩展 `_TransitionNode` 统一管三个属性**：_TransitionNode 是手写的
   controller/Timer 状态机，为 transform（Matrix4 插值）定制；背景色塞进去
   要加第三套 controller 记账。`TweenAnimationBuilder` 是 Flutter 对
   「目标驱动的隐式动画」的现成抽象，语义同 CSS transition，代码少一个
   数量级。
2. **做 color / border-color / 尺寸**：color 在 text widget 层（继承链），
   border 有三条绘制路径，尺寸是布局属性（逐帧重排，性能模型不同）——
   每个都是独立的坑，一个 spec 塞下必然两端对拍糊掉，顺延。
3. **@keyframes 顺带做**：独立引擎，非同一刀。

**既有 transform/opacity**：零代码改动，只登记 + 示例页验证（`:active`
缩放走 `:active` 样式切换 → transform 变化 → 既有 `_TransitionNode`
插值）。

## 4. 风险

- **`:hover` / `:active` 样式切换的动画路径**：hover 样式经 op 12 下发，
  widget 层换的是同一节点的 style map → decoration 重建 → TweenAnimationBuilder
  看到 `end` 变化 → 插值。理论成立，实机验证（示例页就是这条路径）。
- **动画期间节点重建**：每帧 builder 重建 Container——只发生在「有
  background 过渡且正在变化」的节点，静态节点零成本；列表行不声明
  transition，不受影响。
- **delay 不生效**：TweenAnimationBuilder 无延迟钩子；登记差异（css-compat），
  spec §4。
- **文档滞后风险**：transform/opacity 既有支持从未被登记，本次实测后
  登记，避免「文档说没有、实际有」再次发生。

## 5. 验证路径

```bash
# JS 侧（零改动不回归）
pnpm run typecheck && pnpm test

# Dart 侧
cd packages/flutter_fjs && flutter test    # 新增背景色过渡用例

# 两端对拍
pnpm --filter hello-fjs run typecheck && fjs dev --web
fjs run ios    # 「过渡演示」面板：hover/tap 渐变、缩放，两端观感一致
```

新增用例：
- 背景色过渡：红 → 蓝，pump 半程颜色是插值中间色，结束帧等于目标。
- 无 track / duration 0：pump 一帧即到位（瞬时跳变）。
- `transition-property: all` 命中 background-color。
- gradient 背景不参与过渡（直接跳变）。
