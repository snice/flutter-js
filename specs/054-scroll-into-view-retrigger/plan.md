# Plan: 054 scroll-into-view 可重复触发 + 分组吸顶跳转测试

## 改动面

三层，全部小改。不碰 op 协议 / natives / 事件表（宪法 II 不涉及）。

### 1. web 端（`packages/fjs-runtime/src/web/components/basic.ts`）

`FjsScrollView` 的 `applyProps()`：

```ts
// 现在：'' 是 falsy 直接跳过，lastRequestedView 永不重置
if (props.scrollIntoView && props.scrollIntoView !== lastRequestedView) { … }
// 改为：空值先重置记忆（微信"置空重触发"惯用法），非空且变化才滚动
if (!props.scrollIntoView) {
  lastRequestedView = '';
} else if (props.scrollIntoView !== lastRequestedView) {
  lastRequestedView = props.scrollIntoView;
  scrollIntoViewById(props.scrollIntoView);
}
```

注释写明为什么：mp 惯用法 + 宪法 I（同一页面三端行为一致）。

### 2. Dart 端（`packages/flutter_fjs/lib/src/widgets/scroll_view.dart`）

`_applyProps()` 同构改动：`view` 为空 → `_lastRequestedView = null`；
非空且 ≠ 记忆 → 记录并 `_scrollIntoView(view)`。

### 3. 示例页（`examples/hello-fjs/src/pages/comp/sticky.vue`）

- `groups` 增加 `id` 字段（`'A' | 'B' | 'C' | 'D'`）。
- 第一块 Panel 的 scroll-view 绑 `:scroll-into-view="target"` +
  `scroll-with-animation`；组头 `.cap` 视图绑 `:id="g.id"`。
  **id 放内层普通 view**，不放 sticky-header 标签上 —— skyline 的
  virtualHost 组件自身不产节点，id 归属不确定；普通 view 三端都是实节点。
- 按钮行（照 swiper.vue 的 `.mini` toolbar 惯用法）：`jump(id)` 先置空
  再 `nextTick` 设值。
- 顶栏一句文案说明可重复点击验证重触发。

### 4. 测试

- `packages/flutter_fjs/test/scroll_view_props_test.dart`：
  已有"scroll-into-view lands on the named row"—— 新增：到达后拖回 0，
  prop `''` → 再 `'row-5'`，断言仍回到 row-5（旧实现红）。
- `packages/fjs-runtime/test/web-scroll-swiper.test.ts`：等价用例
  （rerender 两拍：空 → 同 id，断言 scrollTop 回到目标）。

### 5. 文档（宪法 VIII）

- `docs/ui-api.md` scroll-view 表 `scroll-into-view` 行：
  补"置空即重置，可重复请求同一 id（三端一致）"。

## 顺序

1. web 改动 + 用例 → `pnpm --filter @ufjs/runtime test`
2. Dart 改动 + 用例 → 需先有 native 构建；`flutter test` 若 native 缺失
   会输出 `No tests ran`（不是通过），此时以 JS 侧 + web 目验为准并注明
3. sticky.vue + docs
4. 全量：`pnpm run typecheck && pnpm test`、`build:pages`、`build:mp`

## 宪法自查

- I 两端同源：本次核心就是把 mp 已有的"置空重触发"补齐到两端 ✔
- II 契约：不涉及 ✔
- V 静默失效：匹配不到已有 warnOnce，不改 ✔
- VII JS 能包：受控 prop 本来就是 JS 侧能力，无新标签 ✔
- VIII 文档：ui-api.md 一行 ✔
