# Spec: 首帧节点数静态预警

- **ID**: 006-static-node-budget
- **状态**: done
- **日期**: 2026-09-03

## 1. 要解决什么

Vue pages 项目里，单个页面首帧如果一次性渲染太多 fjs 节点，Flutter 端会在打开页面时出现明显卡顿。`examples/hello-fjs/src/pages/example/theme.vue` 默认就会渲染几百个列表行，当前真机打开超过 100ms，但开发者只能等到运行时量性能才知道问题。

需要在 `fjs build` / `fjs dev` 的构建期给出静态预警：尽早指出哪个页面的首帧节点数超过预算，并提示改用 `list-view`、分页、拆首帧内容或降低默认行数等优化方向。

## 2. 不做什么（Non-goals）

- 不用静态检查直接预测真实耗时；100ms 是现象，检查输出只报告节点数估算和预算。
- 不把所有动态表达式解释成可执行 JS，不执行用户页面代码，不引入构建期副作用。
- 不改变 UI op 协议、Flutter 渲染、Web DOM 适配或页面运行时行为。
- 不阻断构建；超过预算是 warning，不是 error。

## 3. 用户可见的行为

开发者照常写页面；如果首帧节点预算超限，命令行会在构建输出里看到预警：

```vue
<script setup lang="ts">
import { computed, ref } from 'vue';

const rows = ref(200);
const items = computed(() => Array.from({ length: rows.value }, (_, i) => i));
</script>

<template>
  <scroll-view>
    <view v-for="item in items" :key="item">
      <text>{{ item }}</text>
    </view>
  </scroll-view>
</template>
```

```text
warn: [fjs perf] src/pages/example/theme.vue first frame renders about 800 nodes (budget 500). Prefer list-view/windowing or reduce default rows.
```

可配置预算放在 `package.json` 的 `fjs.performance.nodeBudget`，不配置时使用默认预算。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | 不改变运行时行为；构建期按页面源码估算首帧 fjs 节点数并输出 warning | 同一套源码、同一套 CLI 检查；不改变 Web 运行时行为 |
| 事件载荷 | 不涉及 | 不涉及 |
| 已知差异 | 预警主要服务 Flutter 首帧成本；Web 构建也复用同一诊断，避免两端源码分叉 | Web 端真实 DOM 性能不由本检查预测 |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

## 6. 验收标准

1. `pnpm --filter @ufjs/cli run typecheck` 通过。
2. `pnpm --filter @ufjs/cli run test` 通过。
3. `pnpm --filter hello-fjs exec fjs build --pages --out /tmp/fjs-node-budget-check` 输出包含 `src/pages/example/theme.vue` 的 `[fjs perf]` 节点数预警。
4. 一个没有超限 `v-for` 的普通页面构建时不输出 `[fjs perf]` 预警。
5. `package.json` 中 `fjs.performance.nodeBudget` 能改变预警阈值；设为更大的值后同一页面不再预警。

## 7. 待澄清

无
