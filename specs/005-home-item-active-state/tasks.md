# Tasks: 首页条目按压态

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 确认不涉及 UI op、natives、事件类型契约。

## 实现

- [x] T010 给 `examples/hello-fjs/src/pages/index.vue` 的 `.item` 添加 `:active`。
- [x] T011 给 `examples/hello-fjs/src/pages/example.vue` 的 `.item` 添加 `:active`。

## 两端对齐

- [x] T020 使用已有 `:active` 能力，两端同源码。

## 测试

- [x] T030 运行 hello-fjs typecheck。

## 文档

- [x] T040 示例样式微调，无文档变更。

## 验收

- [x] T050 `pnpm --filter hello-fjs run typecheck`
- [x] T051 spec.md 第 6 节逐条核对
