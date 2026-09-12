# Spec: 伪类补全 — `:first-child` / `:last-child` 与 `:hover`

- **ID**: 040-pseudo-classes-first-last-hover
- **状态**: in-progress（实现与测试全部落地，android / macOS 实机对拍待做）
- **日期**: 2026-09-12

roadmap「近期计划」第一条。`:active`（spec 011 之前的 005 → css-compat §4）已经
铺好了「CSS 引擎多算一份状态样式随帧下发、宿主就地切换、不回 JS」这条路，
本条把两个剩下的伪类沿同一条路补齐。

## 1. 要解决什么

- **列表收尾写不出来**。列表行要「最后一行去掉分隔线」「第一行顶格」，现在
  CSS 表达不了，只能页面 JS 里算 `index === list.length - 1` 拼进 `:class`。
  这是列表场景最高频的一条样式需求，两端都缺（web 上是真 CSS 原生支持，
  但 fjs 的 CSS 引擎在构建期会把带伪类的选择器整条 skip 并告警 —— Flutter
  路径上页面等于没写）。
- **桌面端悬停反馈缺失**。web 桌面浏览器上 `.btn:hover { ... }` 是原生能力，
  App 侧（macOS 桌面）没有任何对应物 —— 同一份代码在桌面 web 上有悬停态、
  在 mac 桌面 App 上没有。移动端两端本来就无 hover，不属于缺口。

现状：`docs/css-compat.md` §1 选择器表里 `:hover`、`:first-child` / `:last-child`
都是 ❌ "roadmap"。

## 2. 不做什么（Non-goals）

- 兄弟组合器 `+` / `~`、`:nth-child(n)`、`:not()`、`:only-child`、
  `:first-of-type` 等其余伪类 —— 遇到照旧 `warnOnce` 跳过。
- **`:hover` / `:first-child` 写在非最后一个复合选择器上时影响后代**
  （`.row:hover .title { ... }`）：`:active` 的既有边界（祖先状态要逐节点对
  跟踪，且要回 JS 重算，违背「不回 JS」的设计），超界照 `:active` 的先例
  告警并跳过该选择器。与 web 的差异登记进 css-compat。
- `:hover` 的过渡动画 —— `transition` 本身在近期计划的 CSS 扩展里，单独做。
  本条 hover 样式切换是瞬时的。
- 触摸长按模拟 hover（移动端照浏览器惯例不触发）。
- `@media`、百分比尺寸、transition —— 近期计划后续条目。

## 3. 用户可见的行为

```vue
<template>
  <scroll-view scroll-y class="page">
    <view v-for="it in list" :key="it.id" class="item">{{ it.text }}</view>
    <button class="btn">点我</button>
  </scroll-view>
</template>

<style>
.item { border-bottom: 1px solid #eeeeee; padding: 12 16; }
/* 最后一行不画分隔线；第一行不留上边距 */
.item:last-child { border-bottom: none; }
.item:first-child { margin-top: 0; }

/* 桌面端鼠标悬停（macOS App / 桌面浏览器）；移动端不触发 */
.btn:hover { background-color: #f2f2f2; }
</style>
```

- 结构变化即时生效：`v-for` push/pop、`v-if` 切换兄弟节点后，受影响兄弟的
  first/last 样式立即重算，不需要页面做任何事。
- `:first-child` / `:last-child` 可写在任意复合选择器上（不只 subject），
  例如 `.list > .item:last-child .txt` —— 参照物是该 compound 命中节点在其
  兄弟序列中的位置。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| `:first-child` / `:last-child` | CSS 引擎（JS 侧）按元素树计算，结果随**普通 style** 下发，无协议外新通道 | 真 CSS 原生，构建期改写不得破坏 |
| 兄弟参照物 | **跳过裸文字产生的 `text` 元素**再判断位置；页面显式写的 `<text>` 照算 | 浏览器天然跳过文本节点；显式 `<text>` 是元素照算 |
| `:hover` 触发 | 桌面端（macOS/Windows/Linux）MouseRegion：指针进入节点**或其子树**即成立，离开取消；移动端永不触发 | 原生 |
| `:hover` 样式下发 | CSS 引擎多算一份 `hoverStyle`，随 op 8 第三槽位下发，宿主就地切换，**不回 JS** | 原生 |
| 与 `:active` 同时命中 | active 覆盖 hover（按压优先），两端一致 | active 覆盖（源顺序在后时同效，文档钉死约定） |
| 特异度 | 伪类各 +10（与 class 同权重），照 CSS | 原生一致 |
| 已知差异 | `.row:hover .title` 这类后代超界不支持（告警）；web 支持 | — |

**text 节点那条要特别说明**：fjs 树里独立文字是 `text` 元素（`createText`），
浏览器里文本节点不算元素；但页面**显式**写的 `<text>` 在 web 上是真实元素、
照常参与 first/last 判定。两种来源要区别对待：Vue 编译
`<view>标题<span>x</span></view>` 的「标题」是裸文字（fjs 树里是 text 元素，
web 上是文本节点）——不跳过它，Flutter 侧 `span` 就不是 first-child；而
`<view><text>a</text><view>b</view></view>` 的 `<text>` 两端都是元素。所以
跳过的判据是**来源**（`createText` 产生的元素标记为 raw，判断位置时跳过 raw
兄弟），不是标签名。v-if 注释锚点本来就不注册进 style engine，天然排除，
与 web 的注释节点不算元素一致。

**`:active` 与 `:first-child` 可叠加**（`.item:active:first-child`）—— 状态
样式按既有 active 通道走，结构判定照常。

## 5. 契约变更（宪法 II）

- [x] UI op 协议：**新增 op 12 `SET_HOVER_STYLE`**（`u32 id, u32
  hoverStyleId`，hover 样式走既有 DefineStyle 样式表），`uiOpsVersion` 5 → 6
  （`engine.dart` 的宿主声明）。同步四处：`fjs-runtime/src/ui/ops.ts` +
  `flutter_fjs/lib/src/ui_ops.dart` + `flutter_fjs/lib/src/mirror_tree.dart`
  （解码）+ `native/tools/fjsrun.cpp`（调试 dump）。
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）—— 不涉及
- [ ] 事件类型（`element.ts` + `fjs.h`）—— 不涉及（hover 不是事件）

旧 host 兼容：JS 侧按协商出的 `uiOpsVersion` 降级 —— `uiOpsVersion < 6` 时
op 12 **不发**（`warnOldHostOnce` 一次，页面布局不受影响，只是无 hover
效果，与 op 10/11 的老宿主降级同款）。first/last-child
是普通样式，任何版本都不受影响。

## 6. 验收标准

1. `pnpm test` 通过；其中 css 引擎新增用例覆盖：first/last 匹配（含 text
   兄弟跳过、任意复合位置、`:active` 叠加）、兄弟插入/删除后的重算、hover
   cascade 与特异度、后代超界告警、`uiOpsVersion < 4` 降级不发。
2. `pnpm run typecheck` 通过。
3. `examples/hello-fjs` 新示例页（列表 first/last + hover 按钮）：
   `fjs dev --web` 下 first/last/hover 全部成立；
   `fjs run android` 下 first/last 成立、无 hover（对照）；macOS
   （`fjs run macos` 或 `flutter run -d macos`）下 hover 成立。
4. hello-fjs 列表页运行时增删一项，两端最后一行的分隔线即时消失/恢复。
5. `docs/css-compat.md` §1 选择器表与 §4 状态伪类小节更新（含已知差异）、
   `docs/roadmap.md` 近期计划对应条目移入已完成。
6. web 回归：既有页面里出现的 `:hover` / `:first-child` 选择器经构建产物
   对比，未被 css-compat 改写破坏（浏览器原生语义保留）。

### 验收记录（2026-09-12）

1. `pnpm test` 全绿（fjs-runtime 43 文件 / fjs 11 / webview 3 / webgl 1）；
   `flutter test` 293 用例全过（含新增 hover_style_test 4 条）；fjs-test 引擎
   自测 ALL PASS。
2. `pnpm run typecheck`：fjs-runtime / hello-fjs 通过；`@ufjs/cli` 有一个
   **main 上就存在**的存量错误（dev-units.test.ts Buffer 泛型漂移，
   stash 掉本 spec 改动后同样报），与本次无关。
3. web 端已在浏览器实测（dev server）：首行灰底 / 末行无分隔线 / 增删行即时
   重算 / 裸文字与显式 text 混排判定 / 悬停变灰，全部符合预期；构建产物抽查
   `:first-child` / `:last-child` / `:hover` 原样保留。
4. **实机对拍（iOS 模拟器，用户截图）修出两处**：demo 页初版的
   `border-bottom` 是引擎不支持的单边边框（web 真 CSS 两端分叉），demo 改为
   容器灰底 + 行间缝隙 + 首末行圆角；`flex-wrap` 子节点在 App 上被拉满行宽
   （Wrap 有界约束 × 默认 stretch 列），`buildFlex` 的 Wrap 分支补上 CSS 的
   flex item 主轴 shrink-to-fit 语义（`_wrapChild`，widget 测试
   `pseudo_layout_test.dart` 回归，flutter test 294 条全过）。
5. **待做**：`fjs run android` 与 macOS 实机复验（host 二进制需重新构建才有
   op 12 与 wrap 修复）。做完把状态改 done。

## 7. 待澄清

- 无。范围即 roadmap 原文两条：`:first-child` / `:last-child`、`:hover`
  桌面端。若希望连 `:only-child` / `:nth-child` 一起做，在 `/plan` 前说明。
