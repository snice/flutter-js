# Plan: 首帧节点数静态预警

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 涉及 | 这是 CLI 构建期诊断，不改 Flutter/Web 运行时。`fjs build --pages`、单包构建和 `--web` 构建共用同一检查输出。 |
| II 边界即契约 | 不涉及 | 不改 UI op、natives、事件类型。 |
| III 同步单线程零序列化 | 不涉及 | 只在 Node 构建进程里解析源码，不增加运行时桥接。 |
| IV 外观照 WeUI | 不涉及 | 不改组件外观。 |
| V 静默失效是 bug | 涉及 | 静态估算遇到可判定超限时输出 warning；遇到未知动态表达式不报确定数字，避免误导。 |
| VI 注释记录权衡 | 涉及 | 新分析器说明为什么只做保守静态求值、不执行用户代码。 |
| VII 变更落到文档 | 涉及 | 更新 `docs/toolchain.md` 的构建诊断说明。 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | `packages/fjs/src/bundler/node-budget.ts` | 新增 Vue SFC 首帧节点数静态估算器。 |
| CLI / 构建 | `packages/fjs/src/bundler/build.ts` | 在构建开始后扫描 pages，收集并返回 `[fjs perf]` warning。 |
| CLI / 构建 | `packages/fjs/src/project/config.ts` | 增加 `fjs.performance.nodeBudget` 配置类型和默认读取。 |
| 测试 | `packages/fjs/test/node-budget.test.ts` | 覆盖超限、未超限、配置阈值、简单 computed Array.from 推导。 |
| 文档 | `docs/toolchain.md` | 记录首帧节点数预警和配置项。 |
| 文档 | `docs/roadmap.md` | 标记 CLI 静态预警能力。 |

## 3. 方案

选定方案：新增一个构建期静态分析器，复用 `@vue/compiler-sfc` 解析 SFC 模板 AST；对模板中的 fjs 元素节点计数，对 `v-for` 只支持可安全静态求值的来源（字面量数组、`const X = [...]`、`ref(number)`、`computed(() => Array.from({ length: ref.value }))`）。跨组件只沿相对导入的本地 `.vue` 组件递归，并把父组件传入的可判定数组长度传给子组件。构建命令把诊断合并进 `BuildResult.warnings`，由现有 warning 打印路径输出。

被否掉的方案：

- 运行页面代码得到真实首帧树：会引入构建期副作用，也需要模拟 Vue runtime 和宿主。
- 只按最终 bundle 文本正则找 `_createElementBlock`：难以把节点数归因回页面，也无法可靠处理 `v-for`。
- 把节点数作为运行期统计从 Flutter 回传：发现问题太晚，且会改运行期契约。

## 4. 风险

静态求值只能覆盖保守子集；复杂表达式可能漏报。为了不制造假确定性，未知循环不乘以拍脑袋的数字，只统计已知部分。递归组件或循环导入需要 visit 集合防止无限递归。

## 5. 验证路径

```bash
pnpm --filter @ufjs/cli run typecheck
pnpm --filter @ufjs/cli run test
pnpm --filter hello-fjs exec fjs build --pages --out /tmp/fjs-node-budget-check
```
