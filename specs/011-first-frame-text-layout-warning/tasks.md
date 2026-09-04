# Tasks: 首帧文本行高静态诊断

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层

- [x] T001 确认本需求不修改 UI op 协议、native ABI 或事件号。

## 实现

- [x] T010 修正 `examples/hello-fjs/src/pages/comp/image.vue` 中 `.lazy-row` 的 18px 内容高度。
- [ ] T011 在 `packages/fjs/src/bundler/node-budget.ts` 增加简单本地 CSS 解析。
- [ ] T012 在首帧静态诊断中检查 `text` 自身 `height` / `min-height` 是否低于 Flutter 单行行盒。
- [ ] T013 在首帧静态诊断中检查直接父容器 `height - paddingTop - paddingBottom` 是否低于子 `text` 单行行盒。

## 测试

- [ ] T020 扩展 `packages/fjs/test/node-budget.test.ts` 覆盖 text `min-height: 18px` warning。
- [ ] T021 扩展测试覆盖 text `height: 18px` warning。
- [ ] T022 扩展测试覆盖父容器内容高度不足 warning。
- [ ] T023 确认足够高度不 warning，既有 node budget 测试不回归。

## 文档

- [ ] T030 更新 `docs/toolchain.md` 记录文本行盒静态诊断。
- [ ] T031 更新 `docs/roadmap.md` 登记 CLI 文本布局预警。

## 验收

- [ ] T040 `pnpm --filter @ufjs/cli run typecheck`
- [ ] T041 `pnpm --filter @ufjs/cli run test`
- [ ] T042 `pnpm --filter hello-fjs run typecheck`
- [ ] T043 spec.md 第 6 节逐条核对
