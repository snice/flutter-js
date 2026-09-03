# Tasks: 首帧节点数静态预警

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 确认本需求不修改 `packages/fjs-runtime/src/ui/ops.ts`、`packages/flutter_fjs/lib/src/ui_ops.dart`、`packages/fjs-runtime/src/ui/element.ts`、`packages/flutter_fjs/native/include/fjs.h`、`packages/fjs-runtime/src/native-global.d.ts`、`packages/flutter_fjs/native/src/natives.cpp`。

## 实现

- [x] T010 在 `packages/fjs/src/project/config.ts` 增加 `fjs.performance.nodeBudget` 类型。
- [x] T011 新增 `packages/fjs/src/bundler/node-budget.ts`，实现本地 Vue SFC 模板节点静态估算。
- [x] T012 在 `packages/fjs/src/bundler/build.ts` 构建流程里调用节点预算检查并合并 warnings。
- [x] T013 更新 `packages/fjs/src/cli.ts` 的帮助文案，说明构建会输出性能预警。

## 两端对齐

- [x] T020 确认 `fjs build`、`fjs build --pages`、`fjs build --web` 共用同一检查路径。
- [x] T021 确认检查只读页面源码，不改变 Flutter/Web 运行期行为。

## 测试

- [x] T030 新增 `packages/fjs/test/node-budget.test.ts` 覆盖超限、未超限、配置阈值、computed Array.from 推导。
- [x] T031 用 `examples/hello-fjs/src/pages/example/theme.vue` 验证能产生节点数预警。

## 文档

- [x] T040 更新 `docs/toolchain.md` 记录首帧节点数预警和 `fjs.performance.nodeBudget`。
- [x] T041 更新 `docs/roadmap.md` 登记 CLI 静态预警能力。

## 验收

- [x] T050 `pnpm --filter @ufjs/cli run typecheck`
- [x] T051 `pnpm --filter @ufjs/cli run test`
- [x] T052 spec.md 第 6 节逐条核对
