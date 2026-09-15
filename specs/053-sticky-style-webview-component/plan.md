# Plan: 样式级 position: sticky + mp webview 自定义组件

对应 spec：`./spec.md`。宪法自查：I 两端同源（样式 sticky 的语义差异
登记；webview 组件与 web 组件同 props/事件）；V 不支持处 warnOnce；
VIII 文档四处。

## 1. Flutter 端样式级 sticky

- `widgets/sticky.dart`：
  - 新增 `fjsIsStickyNode(node)`：tag 是 sticky-header/section，**或**
    `FjsStyle.of(node).position == 'sticky'`（tag 不是 sticky-section——
    section 判定永远走 tag）。
  - `splitNodes` 的 header 分支接受样式 sticky 节点：`offset-top` 取
    `fjsStickyOffsetTop(node)`（标签 prop 优先），无 prop 时取
    `FjsStyle.of(node).topLength?.px`；`%`/calc（isRelative）warnOnce 后
    按 0。
  - scroll adapter（node_adapters.dart）sliver 触发条件改为
    `nodes.any(fjsIsStickyNode)`。
  - sticky-section 的 `_sectionSliver` 不变——`splitNodes` 已识别样式
    sticky 子节点。
  - `_flexChild`（render/flex.dart）：`childNode` 的样式 position ==
    'sticky' → `fjsWarnOnce`（深层嵌套不生效，指向 sticky-header 标签或
    直接子节点结构）。sliver 路径的 run 里不会出现 sticky 节点（被
    split 抽走），普通路径才 warn，无误报。
  - `_stickyContentBox` 已按 view 盒子构建样式 sticky 节点 ✓ 无需改。
- 测试 `sticky_test.dart`：+3 例（样式 sticky 吸顶翻转 / top→pin 线 /
  深层嵌套 warn）。

## 2. mp webview 自定义组件

- 新建 `packages/fjs-runtime/src/wx/components/fjs-sticky-header/` 四件套：
  - json：`{ "component": true, "styleIsolation": "apply-shared", "usingComponents": {} }`
  - js：`Component({ options: { virtualHost: true, mergeVirtualHostAttributes: true }, properties: { offsetTop: { type: null, value: 0 }, allowOverlapping: { type: null, value: false }, padding: { type: null, value: null } }, data: { top: 0 }, observers + attached：offsetTop → data.top = Number || 0 }`；
    IntersectionObserver（`relativeToViewport({ top: -top })`）回调里按
    web 同一公式测 stuck（|rect.top − top| ≤ 0.5 且滚过 naturalTop），
    翻转才 `triggerEvent('stickontopchange', { isStickOnTop })`；offsetTop
    变化时重建 observer、重置状态。
  - wxml：`<view class="fjs-sticky-header" style="top: {{ top }}px"><slot/></view>`
    （virtualHost 下该 view 是页面流真实节点，sticky 生效于页面滚动）。
  - wxss：`.fjs-sticky-header { position: sticky; top: 0px; z-index: 1; }`
    （top 被内联覆盖）。
- 新建 `fjs-sticky-section/` 四件套：virtualHost + `<view class="fjs-sticky-section"><slot/></view>`
  + wxss display:block；properties pushPinnedHeader（接受不生效）。
- `project.ts`：`RUNTIME_COMPONENTS` 加两条（`fjs/fjs-sticky-header/...`）；
  构建 copy 的 skip 逻辑按渲染器分流——**skyline 跳过这两个**（用内置），
  webview 才拷。核对 build.ts 里 skip 的现有来源（rich-text 按使用与否），
  照同一层传。
- `wxml.ts`：
  - `RUNTIME_COMPONENT_TAGS` + `fjs-sticky-header` / `fjs-sticky-section`。
  - `resolveTag`：webview 渲染器的 sticky 分支从 downcast 改为
    TAG_REWRITE 式映射（usingComponents + custom: true）；skyline 保持
    verbatim。
  - `genAttrs`：删 stickyHeaderDowncast 的属性拦截/内联 top 合并（组件
    路径让 `offset-top="{{ … }}"` 原样透传，绑定的 offset-top 不再告警）。
  - `sourceTagOf`：核对 data-tag 产出原 tag（`sticky-header`）——
    events.ts 的 `BY_TAG['sticky-header']` 键保持命中。
- 测试 `mp-compiler.test.ts`：webview 用例改为断言自定义组件输出；
  skyline 用例回归不变。

## 3. demo 与文档

- `sticky.vue`：CSS sticky 块描述改「三端生效（skyline 请用组件）」。
- `docs/ui-api.md`：样式 sticky 三端语义 + 差异；`docs/css-compat.md`：
  position: sticky 改 ✅（Flutter 滚动容器直接子节点语义、深层嵌套 ⚠️）；
  `docs/miniprogram.md`：webview 分流改自定义组件 + virtualHost 说明。

## 4. 验证顺序

契约（无）→ Flutter 样式识别 → mp 四件套 + 编译分流 → 测试 → 文档 →
typecheck/test/build → web 回归目验 → iOS 目验（样式 sticky 现在应吸顶）
→ devtools 切 webview 渲染器目验（automator 驱动 scroll-view 滚动 +
截图 + 事件面板）。
