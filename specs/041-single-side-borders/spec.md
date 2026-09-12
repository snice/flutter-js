# Spec: 单边边框 — `border-top` / `border-right` / `border-bottom` / `border-left`

- **ID**: 041-single-side-borders
- **状态**: done
- **日期**: 2026-09-12

## 1. 要解决什么

spec 040 实机对拍时踩到：页面写 `border-bottom: 1px solid #eee`（列表分隔线
的最常见写法），web 上是真 CSS 正常渲染，App 上**整条静默丢弃**——
`docs/css-compat.md` 的「单边边框 ❌」登记是老决策，但没有任何运行时告警，
页面作者只能在页面翻车对拍后才知道。列表分隔线、卡片顶部分隔、输入框下划
线这些场景全被挡住，页面被迫用 divider 标签或缝隙背景色凑。

Flutter 的 `Border` 本身支持非均匀边框（`Border(top:, right:, bottom:, left:)`），
绕开它的唯一硬约束是：**BoxDecoration 的非均匀 Border 不能配 `borderRadius`**
（assert 直接崩）——这才是当年登记 ❌ 的真实原因，dashed_border.dart 的自绘
painter 已经把「绕开 BoxDecoration 画边框」这条路踩通了。

## 2. 不做什么（Non-goals）

- 逻辑属性（`border-block` / `border-inline`）。
- `border-image`。
- 单边圆角（`border-bottom-left-radius`，Flutter 侧其实可行，单独评估）。
- 修「简写与长手的源顺序语义」：fjs 的样式引擎按合并后的 map 定优先级
  （现有 `border` 与 `border-width` 就是这么做的），无法还原样式表里的书写
  顺序——见「两端约定」的已知差异。
- 构建期对不支持属性的静态告警（roadmap 的 `fjs lint`，另条目）。

## 3. 用户可见的行为

```vue
<template>
  <view class="page">
    <!-- 列表分隔线：spec 040 demo 里被迫用缝隙背景色的写法，现在可以直接写 -->
    <view v-for="it in items" :key="it.id" class="row">{{ it.text }}</view>

    <!-- 卡片顶部分隔 + 下划线输入框风格 -->
    <view class="card">...</view>
    <input class="line" />
  </view>
</template>

<style>
.row { padding: 12 16; border-bottom: 1px solid #eeeeee; }
.row:last-child { border-bottom: none; }
.card { border-top: 2px solid #007aff; }
.line { border: none; border-bottom: 1px solid #dddddd; border-bottom-color: #007aff; }
</style>
```

- 简写（`border-bottom: 1px solid #eee`，值序任意、可缺省）与六个长手
  （`border-bottom-width` / `-color` / `-style` × 四边）都可用；内联
  `:style="{ borderBottom: ... }"` 同样成立（camelCase 直接透传）。
- `border-bottom: none` / `border-bottom-width: 0` 关掉该边。
- 只写 `border-bottom-color`：CSS 语义，该边按 1px 实线算（与全局
  `border-color` 单独出现的现行规则一致）。
- 与圆角组合合法（见两端约定的降级路径）；与 `:active` / `:hover` 状态样式
  组合天然成立（边框键只是普通样式键，走既有状态变体通道）。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 解析 | JS 引擎**零改动**（键透传），全部工作在 Dart 侧解析与绘制 | 真 CSS 原生，构建期改写不涉及 |
| 无圆角 | `Border(top/right/bottom/left)` 原生非均匀绘制 | 原生 |
| 圆角 + 四边一致 | `Border.all` + radius（现状路径） | 原生 |
| 圆角 + 非一致 | **CustomPainter 按边分段描**（圆角弧段归相邻边各半，对齐 CSS 的角归属），沿 dashed_border 先例；布局占位按各边宽度预留 | 原生 |
| 每边级联 | `border-<side>-长手` > `border-<side>` > `border-width/color/style` > `border` > 内建默认（button hairline 只补完全未声明的边）；`none`/0 宽 = 该边没有 | 源顺序 |
| 已知差异 | 合并 map 定优先级，不还原源顺序：`border-bottom: none` 之后再写 `border: 1px red`，web 上 bottom 回来（简写重置），App 上 bottom 仍无 | — |
| 已知差异 | 非一致 + 圆角的角部衔接是自绘近似（对角相接处与浏览器的抗锯齿细节有亚像素差） | 原生 |

style 键不新增协议槽位、不动 `uiOpsVersion`——边框键走既有 style JSON 与
状态变体通道。

## 5. 契约变更（宪法 II）

- [x] UI op 协议（`ops.ts` + `ui_ops.dart`）—— **不涉及**（样式 map 内容变化，
  协议形状不变）
- [ ] natives 表 —— 不涉及
- [ ] 事件类型 —— 不涉及

## 6. 验收标准

1. `pnpm test` 通过（JS 引擎零改动的断言：`border-bottom` 等键经
   `parseStylesheet` / `parseInlineCss` 原样出现在 style map）。
2. `flutter test` 通过，新增用例覆盖：
   - 每边级联（长手 > 单边简写 > 全局长手 > 全局简写）、`none`/0 宽、
     仅 `border-bottom-color` 推出 1px；
   - 无圆角非均匀 → `Border` per-side；圆角 + 一致 → `Border.all` 现状路径
     不回归；圆角 + 非一致 → 走自绘 painter 且占位正确；
   - `button` 默认 hairline 与 `border-bottom: none` 共存（其余三边保留默认）。
3. hello-fjs「伪类」页新增「单边边框」面板（列表 `border-bottom` 分隔线 +
   `border-bottom: none` + 卡片 `border-top` + 圆角配单边），`fjs dev --web`
   与 `fjs run ios`（或 android）对拍一致。
4. `docs/css-compat.md` 边框表「单边边框 ❌ → ✅（含差异）」、`docs/roadmap.md`
   移入已完成；`docs/ui-api.md` 样式清单核对。
5. demo / hello-fjs 既有页面回归：现有 `border` / `border-color` 用法与
   button 默认描边不变。

### 验收记录（2026-09-12）

1. `pnpm test` 全绿（fjs-runtime 44 文件，含新增 3 条透传断言）；`flutter test`
   308 条全过（新增 side_border_test 14 条：每边级联、三条绘制路径、button
   默认逐边补、painter 几何）；既有 dashed_border 测试不回归。
2. 实现中抓到并修掉一个自造 bug：`FjsBoxBorders.isUniform` 初版把「缺一边」
   也判成 uniform，`border-bottom: none` 的按钮三边默认被画成了 Border.all
   ——widget 测试当场拦下。
3. web 端已在浏览器实测（伪类页「单边边框」面板）：分隔线 / `:last-child`
   关掉 / 圆角配 `border-top` 全部正确。
4. iOS 模拟器复验（我自己重启了 `fjs run ios`，原会话已退出）：面板两端
   一致。复验过程揪出并修掉一个**老缺口**：`<view>裸文字</view>` 与 `{{ }}`
   的元素文本挂在 view 节点自身（web 是文本节点），Dart view 适配器从不读
   `node.text`——整段静默丢弃。修复：合成为 Text 子节点排最前（`kidNodes`
   垫 null 保持逐子记账对齐），`view_text_test.dart` 锁定，`flutter test`
   310 条全过。排查手段：`fjs eval` 注入手工编码的 UI op 探针 + 模拟器
   截图二分（border / 方向 / 颜色字号 / row / 动态文本逐项排除）。
   `pnpm run typecheck` 的 `@ufjs/cli` 存量错误与 spec 040 无关（见 040 记录）。
5. 用户复审指出行高两端不齐，像素对拍定案为 **web 丢了 padding**：无单位
   长度（`padding: 10 12`）对浏览器非法、整条声明被丢，App 端语义（无单位
   = 逻辑像素）才是 css-compat 登记的那个。修复在 `rewriteFjsCss` 按白名单
   补 px（App 端零改动），修复后 srow 41px / 40pt、list row 44.6px / 45pt，
   两端在取整误差内一致。

## 7. 待澄清

- 无。圆角 + 非一致边的绘制策略（自绘分段，弧段归相邻边各半）与既有登记的
  降级语义（拆成 uniform 绘制 + 告警）二选一，本 spec 选了前者——若倾向
  先做降级告警的保守版，在 `/plan` 前说明。
