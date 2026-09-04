# Spec: 首帧文本行高静态诊断

- **ID**: 011-first-frame-text-layout-warning
- **状态**: ready
- **日期**: 2026-09-04

## 1. 要解决什么

Flutter 侧 `text` 默认 `font-size: 14px`、`line-height: 1.4`，实际单行行盒约为
20px。页面样式如果把 `text` 自己，或只包了一行 `text` 的容器，约束到更小的内容
高度（例如 `height: 34px; padding: 8px`，内容区只剩 18px），Web 端通常看不出问题，
但 Flutter 会在首帧反复抛出 `RenderFlex overflowed by 2.0 pixels on the bottom`。

需要把这类“静态可见的文本高度不足”纳入已有首帧静态诊断，在 `fjs build` /
`fjs dev` 阶段输出 warning，尽早指出具体页面与 selector。

## 2. 不做什么（Non-goals）

- 不执行页面 JS，不做真实布局引擎，也不尝试完整 CSS cascade。
- 不改变 Flutter/Web 运行时行为、UI op 协议或事件协议。
- 不阻断构建；诊断只输出 warning。
- 不覆盖复杂动态 class/style、媒体查询、百分比高度或运行时计算样式。

## 3. 用户可见的行为

当页面中出现静态 `text` 高度风险时，构建输出 `[fjs perf]` warning：

```vue
<template>
  <view class="row">
    <text>lazy row</text>
  </view>
</template>

<style scoped>
.row {
  height: 34px;
  padding: 8px;
}
</style>
```

```text
warn: [fjs perf] src/pages/comp/image.vue text in ".row" gets about 18px content height, below Flutter line box ~20px. Increase height/padding balance or set an explicit smaller line-height.
```

直接写在 `text` 上的 `height` / `min-height` 也会被检查：

```css
.event-value {
  font-size: 12px;
  min-height: 18px;
}
```

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | 不改运行时；CLI 静态读取 Vue SFC 模板与本地 `<style>`，估算文本单行最小行盒 | 复用同一 CLI 诊断；不改浏览器运行时 |
| 事件载荷 | 不涉及 | 不涉及 |
| 已知差异 | 诊断服务 Flutter 的 `Text` 行盒和 `Flex` overflow；Web 未必复现 | Web 不用本诊断预测 DOM 布局 |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

## 6. 验收标准

1. `pnpm --filter @ufjs/cli run typecheck` 通过。
2. `pnpm --filter @ufjs/cli run test` 通过。
3. `.event-value { font-size: 12px; min-height: 18px; }` 会输出文本行盒 warning。
4. `.lazy-row { height: 34px; padding: 8px; }` 包含默认 `<text>` 时会输出内容高度 warning。
5. `examples/hello-fjs/src/pages/comp/image.vue` 不再触发 Flutter 侧 18px 内容高度 overflow。

## 7. 待澄清

无
