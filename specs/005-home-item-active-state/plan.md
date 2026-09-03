# Plan: 首页条目按压态

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 涉及 | 使用已有 `:active` CSS 支持，Flutter 和 Web 都走同一份页面源码。 |
| II 边界即契约 | 不涉及 | 不改 op、natives、事件。 |
| III 同步单线程零序列化 | 不涉及 | 纯样式变更。 |
| IV 外观照 WeUI | 涉及 | 采用列表项常见浅灰按压反馈。 |
| V 静默失效是 bug | 不涉及 | 选择运行时已支持的 `:active` 形式。 |
| VI 注释记录权衡 | 不涉及 | 样式足够直接，无需新增注释。 |
| VII 变更落到文档 | 不涉及 | 示例页样式微调，不改变 API/契约。 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | `packages/fjs/src/…` | 不涉及。 |
| JS runtime | `packages/fjs-runtime/src/…` | 不涉及。 |
| Web 适配层 | `packages/fjs-runtime/src/web/…` | 不涉及。 |
| C++ 引擎 | `packages/flutter_fjs/native/src/…` | 不涉及。 |
| Dart 宿主 | `packages/flutter_fjs/lib/src/…` | 不涉及。 |
| 示例 | `examples/hello-fjs/src/pages/index.vue`、`examples/hello-fjs/src/pages/example.vue` | 给 `.item` 添加 `:active` 样式。 |

## 3. 方案

沿用仓库已有的 `:active` 写法，直接添加 `.item:active { background-color: #f7f7f7; }`。不加 JS pressed 状态，避免额外事件和响应式对象。

## 4. 风险

`item` 本身没有圆角，按压态会被 group 的 `overflow: hidden` 裁剪在容器内；这是列表项预期表现。

## 5. 验证路径

```bash
pnpm --filter hello-fjs run typecheck
```
