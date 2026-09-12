# Spec: transition 过渡——登记既有支持并补背景色

- **ID**: 045-transition-background
- **状态**: done
- **日期**: 2026-09-12

## 1. 要解决什么

roadmap「近期计划 · CSS 扩展」的收尾项。探明现状后，问题的形状是
「一半已实现但没登记 + 一半真缺」：

- **已实现但文档登记 ❌**：`transform` / `opacity` 的 transition 在 App 端
  有完整实现（`decoration.dart` 的 `transitionNode` / `_TransitionNode`，
  简写与长手、duration/curve/delay 都解析），001/002 时期为 paint-only
  包装而建。css-compat 与 ui-api 仍登记 `transition ❌`——页面作者按文档
  不敢用，两端对拍也无从谈起。
- **真缺**：`background-color` 过渡——hover 变色渐变、按钮反馈是真实页面里
  transition 的最高频用法，App 端目前是瞬时跳变（web 是真 CSS 正常渐变），
  两端分叉且无告警。

## 2. 不做什么（Non-goals）

- **`@keyframes` / `animation`**：独立引擎（keyframes 解析、逐帧插值、
  播放状态机），体量与 transition 不同，单独开 spec。
- **`color`（文字色）过渡**：文字色走继承与 text widget 路径，与 decoration
  的组装层不同源，顺延。
- **`border-color` / `box-shadow` 的过渡**：border 有三条绘制路径
  （uniform/per-side/painter），顺延。
- **尺寸（width/height）**：初版顺延，实现中应用户要求一并做了——布局
  属性逐帧重排，成本与 web 一致，靠显式 track 门控（见 §3 追加）。
- **`transition-behavior`、`view-transition`** 等新特性：不支持，照旧
  warnOnce 或忽略。
- **Web 侧改动**：真 CSS 原生，零改动。

## 3. 用户可见的行为

```vue
<template>
  <view class="btn" @tap="toggle">{{ on ? '开' : '关' }}</view>
  <view class="card" :class="{ active: on }">卡片</view>
</template>

<style scoped>
.btn {
  padding: 10 16;
  background-color: #07c160;
  transition: background-color 0.3s ease, transform 0.2s;
}
.btn:active { transform: scale(0.95); }
.card {
  background-color: #ececec;
  transition: background-color 0.3s;
}
.card.active { background-color: #1c3d78; }
</style>
```

- App 端：类切换 / `:active` / `:hover` 引起的 `background-color` 变化
  **按 duration + curve 渐变**（按帧插值），不再瞬时跳变；`transform` /
  `opacity` 维持既有行为；`width` / `height` 同样渐变（逐帧重排，§2 追加）。
- Web 端：浏览器原生，同一份代码两端渐变观感一致（时长、缓动同源）。
- `transition-property: all` 对可动画属性（transform / opacity /
  background-color）统一生效，与 CSS 一致。
- 无 transition 声明或 duration 为 0：瞬时跳变，路径零开销（不包动画
  widget）。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | `transitionNode`（transform/opacity，既有）+ `box()` 的背景色 `TweenAnimationBuilder`（本 spec）：仅当命中的 track duration > 0 时包动画 widget | 浏览器原生 |
| 支持的可动画属性 | `transform` / `opacity` / `background-color`（实色）/ `width` / `height` | 原生全集 |
| 已知差异 | ① `transition-delay` 对 background-color / 尺寸不生效（`TweenAnimationBuilder` 无延迟钩子，transform/opacity 的 Timer 延迟保留）；② 渐变背景（gradient）不参与过渡，直接跳变；③ 文字 `color`、`border-color`、其余布局属性不动画（顺延）——App 端这些属性瞬时跳变，web 原生渐变，登记为两端差异 | 原生 |

**实现中修出的存量 bug（与 transition 无关但被本 spec 的对拍暴露）**：
`:active` / `:hover` 的 **transform 从不渲染**——transform 的唯一应用点
`transitionNode` 在 `_buildNode` 里吃的是基础样式，按压/悬停变体只流进
decoration（不处理 transform）。修复：包装移入状态 builder，由状态样式
驱动；包装位置不变，`_TransitionNode.didUpdateWidget` 按目标插值。
回归测试断言 X 轴缩放（`storage[0]`）——`getMaxScaleOnAxis` 读恒为 1 的
Z 轴，对 2D scale 恒返回 1.0，别用它。

解析层零改动（`parseTransitions` 已完备）；`transition-property` 的
属性名归一化（`background-color` / `backgroundColor` / `all`）沿用现有
`_normalizeTransitionProperty`。

## 5. 契约变更（宪法 II）

- [x] op 协议 / natives / 事件三张表：**零改动**——`transition` 键本来就是
  样式 map 里的字符串透传，本 spec 全部工作在 Dart 渲染层与文档
- 其余：`render/decoration.dart` 的 `box()`（背景色动画分支）、
  `docs/css-compat.md` / `docs/ui-api.md` 表格改登记、`docs/roadmap.md`

## 6. 验收标准

1. `pnpm test` / `pnpm run typecheck` 通过（JS 侧零改动不回归）。
2. `flutter test` 全量通过，新增：背景色过渡的 widget 测试——同节点
   背景从红到蓝，`pump` 中间帧颜色介于两者之间、结束帧等于目标色；
   无 track / duration 0 时瞬时跳变；`transition-property: all` 命中。
3. hello-fjs 新增「过渡演示」面板（`:active` 缩放 + 背景渐变按钮 +
   类切换卡片），web 与 App 渐变观感一致。
4. iOS 模拟器 / 浏览器两端对拍通过。

## 7. 待澄清

- [ ] 无（@keyframes 顺延、其余属性顺延已写入 Non-goals；范围是「登记
  既有 + 补背景色」这一刀）。
