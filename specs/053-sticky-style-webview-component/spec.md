# Spec: 样式级 position: sticky 全端生效 + mp webview 渲染器走自定义组件

- **ID**: 053-sticky-style-webview-component
- **状态**: ready
- **日期**: 2026-09-15

## 1. 要解决什么

spec 052 交付后的两个不对齐：

1. `position: sticky` 样式在 web / 小程序 webview 是原生 CSS，Flutter 端
   却 warnOnce 后忽略——demo 里的「CSS sticky」块在 Flutter 上不吸顶。
   Flutter 端已有完整的 sliver 吸顶基础设施（052），样式级 sticky 可以
   直接翻译成同一套布局，不必重写定位层。
2. 小程序 **webview 渲染器**下 sticky-header / sticky-section 被降级成
   `view + class`：`bindstickontopchange` 挂在 view 上永远不会派、绑定的
   `offset-top` 告警后不生效——事件与动态属性在 webview 端是断的。
   编译按渲染器分流（skyline 内置 / webview 自定义组件）即可对齐。

## 2. 不做什么（Non-goals）

- Flutter 端**深层嵌套**的样式级 sticky（不是滚动容器直接子节点、也不在
  sticky-section 里）不做——那需要重写整个定位层；warnOnce 指向正确结构
  （宪法 V），文档登记。
- skyline 的 wxss `position: sticky` 不承诺（官方推荐组件；demo 的 CSS
  块注明 skyline 用组件）。
- 样式级 sticky 不派 `@stickontopchange`（web 原生样式也没有事件，两端
  一致；要事件请用 sticky-header 标签）。
- webview 自定义组件不实现 push-pinned-header 的推挤测量（CSS 语义天然
  按父盒子边界离场，与 web 相同，接受不生效）。

## 3. 用户可见的行为

```vue
<!-- 样式级 sticky：三端一致（Flutter 端新增生效） -->
<scroll-view scroll-y style="height: 300px">
  <view style="position: sticky; top: 0" class="cap">表头</view>
  <view>行…</view>
</scroll-view>

<!-- webview 渲染器：offset-top 绑定值、事件真正生效 -->
<sticky-header :offset-top="n" @stickontopchange="onStick">…</sticky-header>
```

- Flutter：滚动容器直接子节点（或 sticky-section 直接子节点）带
  `position: sticky; top: N` 时按 sticky-header（offset-top=N）参与吸顶
  布局；深层嵌套 warnOnce 并按普通盒子渲染。
- 小程序 webview：编译产出 `fjs-sticky-header` / `fjs-sticky-section`
  自定义组件（runtime 四件套，`virtualHost`），`offset-top` 支持绑定值，
  事件由组件内部 IntersectionObserver 测量触发；skyline 分支不变。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 样式级 sticky 语义 | 滚动容器直接子节点 → 整段吸顶；sticky-section 内 → 随组边界离场（sliver 组边界 = web 的父元素盒子） | 原生 CSS（吸顶边界 = 父元素盒子） |
| 样式级 sticky 的 top | `top: N` → pin 线 offset-top=N；`%`/calc 告警后按 0 | 原生 |
| 样式级 sticky 事件 | 不派（同 web） | 不派 |
| 深层嵌套样式 sticky | warnOnce + 普通盒子 | 原生生效（吸顶于最近滚动祖先） |
| sticky-section 里的样式 sticky | 识别为组内 header 项 | 原生 |

做不到一致的：深层嵌套（见 Non-goals）。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议：不涉及
- [ ] natives 表：不涉及
- [x] 事件类型：不新增（复用 052 的 stickontopchange=34）
- [x] mp 组件面：新增 runtime 四件套 `fjs-sticky-header` / `fjs-sticky-section`
  （webview 渲染器专用；skyline 用内置组件，不拷贝）

## 6. 验收标准

1. `pnpm run typecheck`、`pnpm test` 通过；`flutter test` 通过。
2. `mp-compiler.test.ts`：webview 渲染器输出 `fjs-sticky-header`
   自定义组件（usingComponents + `bind:stickontopchange` + `offset-top`
   原样透传），不再降级 view；skyline 分支回归不变。
3. `sticky_test.dart`：样式 sticky 参与 sliver 吸顶、top→offset-top、
   深层嵌套 warn 各一条。
4. hello-fjs sticky demo 的 CSS sticky 块在 iOS 模拟器（Flutter）上吸顶。
5. devtools 切 webview 渲染器：sticky 页渲染、`fjs-sticky-header` 组件
   挂载、滚动吸顶、事件面板收到 JSON 载荷（automator 可驱动 webview
   scroll-view 时自动化验证）。
6. 文档：`docs/ui-api.md`（样式 sticky 三端语义）、`docs/css-compat.md`
   （position: sticky 改 ✅/差异登记）、`docs/miniprogram.md`
   （webview 分流改自定义组件）。

## 7. 待澄清

- 无（webview 自定义组件采用 `virtualHost: true` + 根节点内联
  `top`——sticky 必须作用在页面流真实节点上，否则吸顶边界会缩到宿主
  自身高度；这是实现时定死的技术决策，不是产品分叉）。
