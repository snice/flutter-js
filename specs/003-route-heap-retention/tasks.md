# Tasks: 路由切换后的 heap 滞留

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 确认本需求不修改 UI op / natives / 事件类型契约：`packages/fjs-runtime/src/ui/ops.ts`、`packages/flutter_fjs/lib/src/ui_ops.dart`、`packages/fjs-runtime/src/ui/element.ts`、`packages/flutter_fjs/lib/src/ffi.dart`

## 实现

- [x] T010 完成子树卸载时的事件 handler 释放，并去掉生产代码里的临时全局诊断：`packages/fjs-runtime/src/ui/element.ts`、`packages/fjs-runtime/src/vue/renderer.ts`
- [x] T011 在 style engine 忘记元素时裁剪该元素关联的 match/chain cache：`packages/fjs-runtime/src/css/style.ts`
- [x] T012 核对 Dart mirror tree 删除子树路径，如有索引滞留则补清理：`packages/flutter_fjs/lib/src/mirror_tree.dart`

## 两端对齐

- [x] T020 核对 Web 侧 route pop / tab keep-alive 语义不变：`packages/fjs-runtime/src/app/web.ts`、`docs/web.md`
- [x] T021 两端行为对拍：普通详情页 pop 销毁，tab 页切换保活，离开 tab 组销毁 parked tabs

## 测试

- [x] T030 补/整理 Vue 子树卸载 handler 回归测试：`packages/fjs-runtime/test/vue_unmount_handlers.test.ts`
- [x] T031 补/整理路由重复切换释放回归测试：`packages/fjs-runtime/test/zz_leak_probe.test.ts`
- [x] T032 补 Dart mirror tree 删除子树索引回归测试：`packages/flutter_fjs/test/mirror_tree_test.dart`

## 文档

- [x] T040 更新路由生命周期说明：`docs/vue3.md`、`docs/web.md`
- [x] T041 核对 `docs/roadmap.md` 是否需要新增完成项；若不涉及公开 roadmap，则记录为无需修改

## 验收

- [x] T050 `pnpm --filter @ufjs/runtime test`
- [x] T051 `cd packages/fjs-runtime && pnpm run typecheck`
- [ ] T052 `cd packages/flutter_fjs && flutter test`
- [ ] T053 spec.md 第 6 节逐条核对
