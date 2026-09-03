# Tasks: fjs run dev 端口自动递增

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 确认不涉及 UI op、natives、事件类型契约。

## 实现

- [x] T010 在 `packages/fjs/src/commands/run.ts` 抽出端口选择 helper。
- [x] T011 让 `startDevServer` 返回实际端口。
- [x] T012 让 `runCommand` 使用实际端口生成 `FJS_DEV`。

## 两端对齐

- [x] T020 Web 侧不涉及。
- [x] T021 Flutter/Dart 宿主代码不变，只接收 CLI 传入的实际 `FJS_DEV`。

## 测试

- [x] T030 添加 CLI 端口选择单测。

## 文档

- [x] T040 更新 `docs/toolchain.md`。

## 验收

- [x] T050 `pnpm --filter @ufjs/cli test`
- [x] T051 `pnpm --filter @ufjs/cli run typecheck`
- [x] T052 spec.md 第 6 节逐条核对
