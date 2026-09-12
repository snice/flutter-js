# Spec: 百分比扩展到盒模型间距与定位偏移

- **ID**: 044-percent-spacing-offsets
- **状态**: done
- **日期**: 2026-09-12

## 1. 要解决什么

roadmap「近期计划 · CSS 扩展」第二条。`%` 与 `calc()` 目前**只在尺寸属性上
生效**（width/height/min/max，spec 036 之前落的），css-compat 单位表登记的
缺口：

> ❌ 其他属性上的 `%`（`padding` / `margin` / `gap` / `border-radius` /
> `top` 等按 CSS 也是百分比，这里读不出来，等同没写）

页面最常见的两种写法直接踩坑：

- `padding: '0 5%'`（响应式内边距）、`margin: '0 auto'` 之外的流式留白
  —— App 端整条静默失效（`parseLength` 读不出 `%` 返回 null），web 端是
  真 CSS 正常渲染，两端分叉且无告警；
- `position: relative; left: 50%`（居中平移、错位排版）、
  `position: absolute; top: 50%`（遮罩/气泡定位）—— 同样 App 端无效。

css-compat 的「数字不带单位 = 逻辑像素」改写只针对无单位数，`10%` 原样
透传，所以 web 一直是**生效**的那一端——这是「宪法 I 分叉 + 无兜底」
的双重违例，与 041 的 `padding: 10 12` 同一性质。

## 2. 不做什么（Non-goals）

- **`gap` 的 `%`**：CSS 语义是「沿对应轴参照内容盒」，无界时按 `normal`
  处理，且使用率低——顺延。
- **`border-radius` 的 `%`**：参照自身盒宽高（水平/垂直半径各一轴），
  机制不同（不是参照父盒），顺延。
- **`font-size` 的 `%`**：参照父字号，归属文字族而非盒模型，顺延。
- **`text-indent`、`background-position` 等更冷门的 % 属性**：不在
  css-compat 单位表登记范围内，不动。
- **input / textarea 的 `contentPadding`、`<swiper>` 高度等「布局前就要数」
  的消费点**：维持现状只认绝对值（css-compat 单位表已有同款登记），只在
  文档注明。
- **JS 侧与 web 侧改动**：JS 引擎对 `%`/`calc()` 值本来就按字符串透传；
  web 是真 CSS。本 spec 全部工作在 Dart 渲染层。

## 3. 用户可见的行为

```vue
<template>
  <view class="page">
    <view class="card">内容</view>
    <view class="badge">badge</view>
  </view>
</template>

<style scoped>
.page { padding: 0 4%; }          /* 参照父盒宽度的流式留白 */
.card { margin: 12 5%; }          /* 左右留白随窗口伸缩 */
.badge { position: relative; left: 50%; }   /* 平移半个父盒宽 */
.overlay { position: absolute; top: 50%; left: 50%; }  /* 居中遮罩 */
</style>
```

- App 端这些声明**生效**，参照轴按 CSS：`padding`/`margin` 四个边全部
  参照**父盒内容宽度**（含上下边，CSS 就是这样）；`left`/`right` 参照父盒
  宽，`top`/`bottom` 参照父盒高。
- 参照无界时按 CSS 语义**退化为 0 / auto**（列表里、scroll-view 纵向、
  row flex 的主轴约束被放宽后由 flex 把上界传下去——与现有 `width: 50%`
  在 flex 里的机制同一条）。
- `calc(100% - 32px)` 同步生效（同一 `FjsLength` 通道）。
- `padding`/`margin` 的长手（`padding-left: 10%`）与简写混写时，长手覆盖
  简写——与现有 px 行为一致。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | `FjsLength`（px + %）随样式下发，布局期按入参约束解析；`padding`/`margin` 参照入参 `maxWidth`，`top`/`bottom` 参照 `maxHeight`，`left`/`right` 参照 `maxWidth`；无界参照该边按 0 处理 | 浏览器原生 |
| 已知差异 | 参照物是**传到该节点的约束上界**而非严格意义的「父内容盒」：row flex 子项经 `_flexChild` 传入容器宽上界（与 CSS 一致）；Wrap 与 scroll-view 纵向内的子项取到无界 → 按 0，与 CSS 的无界退化一致 | 原生 |

要点：**web 零改动**（真 CSS，语义本来就一致）；JS 零改动（字符串透传）。
`rewriteFjsCss` 的无单位补 px 对 `10%` 无作用（token 非纯数字），不受
media 掩码改动影响（有既有回归测试）。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议：**不涉及**——样式值仍是同一份 merged style map，
  `%`/`calc()` 本来就以字符串在 map 里传输
- [x] natives 表：**不涉及**
- [x] 事件类型：**不涉及**
- 其余：全部在 `flutter_fjs/lib/src/render/`（style.dart 加 `FjsLength`
  版的 edge/offset 读取与 `hasRelative*` 门；decoration.dart 加两个
  LayoutBuilder 分支；flex.dart 的 `_flexChild`/Wrap/`positionedChild`
  门控扩展），**op 协议字节零变化**

## 6. 验收标准

1. `pnpm test` / `pnpm run typecheck` 通过（JS 侧应零改动，既有测试不回归）。
2. `flutter test` 全量通过，新增：`style_parse`/`style` 的
   FjsLength-edge 解析与长手优先级用例；decoration 层 widget 测试——
   两种入参宽度下 `%` padding 解析出不同 EdgeInsets、无界宽度按 0；
   `positionedChild` 的 `top: 50%` / `left: 50%` 解析；`relativeOffset`
   的 `left: 50%`。
3. hello-fjs 示例页新增「百分比间距与偏移」面板（`padding: 0 4%`、
   `margin: 12 5%`、relative `left: 50%`、absolute 居中遮罩），
   web 构建产物与 App 表现一致（拖窗宽度变化时留白同步伸缩）。
4. iOS 模拟器 / 真机对拍（可挂起注明，沿用 043 惯例）。

## 7. 待澄清

- [x] 无（参照轴语义按 CSS 标准，`gap`/`border-radius`/`font-size` 顺延
  已写入 Non-goals）。

## 8. 实现中修的问题（对拍记录）

- **iOS 点进示例页卡死（已修）**：margin / relativeOffset 两个
  LayoutBuilder 的 builder 闭包捕获的是 `w` 变量而非赋值时的值——builder
  在布局期才执行，此时 `w` 已被后续分支重新赋值为 LayoutBuilder 自己，
  构成自引用，布局无限递归（`RenderBox was not laid out` 异常风暴）。
  decoration 既有的 width/constraints 分支用 `final inner = w` 拍快照
  正是防这个，新分支照做了。App 端 web 端行为差异不在 web——web 走真
  CSS 没有这层 widget 组装，这类 bug 只有 App 实测能暴露。
- **测试前提修正**：竖向滚动容器里宽度是有界的（CSS 语义），
  `%` padding 在那里应该解析——「scroller 内 % 失效」只对横向成立，
  用例按此改写。
- **顺带修掉存量静默失效**：edge 简写按裸空格切分，`calc(50% - 8px)`
  被切碎整条丢弃；改为括号感知切分（绝对值路径一起修）。
