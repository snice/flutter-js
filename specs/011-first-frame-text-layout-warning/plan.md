# Plan: 首帧文本行高静态诊断

## 范围

在已有 `packages/fjs/src/bundler/node-budget.ts` 首帧静态检查中增加文本高度风险诊断，
并修正 `hello-fjs` image 示例里 8 个 lazy row 的 18px 内容高度。

## 改动计划

| 层 | 文件 | 改动 |
|---|---|---|
| 示例 | `examples/hello-fjs/src/pages/comp/image.vue` | 调整 `.lazy-row` 高度，让默认单行文本获得不少于 Flutter 行盒的内容高度。 |
| CLI / 构建 | `packages/fjs/src/bundler/node-budget.ts` | 解析本地简单 CSS class/tag 规则与静态 inline style，检查 `text` 自身 `height`/`min-height` 和直接父容器内容高度。 |
| 测试 | `packages/fjs/test/node-budget.test.ts` | 覆盖不足/足够文本高度、父容器内容高度不足、既有节点预算不回归。 |
| 文档 | `docs/toolchain.md`, `docs/roadmap.md` | 将“首帧节点数预警”扩展为“首帧静态诊断”，登记文本行盒检查。 |

## 顺序

1. 先修示例真实 overflow。
2. 扩展 analyzer 的样式解析与 warning 输出。
3. 增加回归测试。
4. 更新文档与 tasks。
5. 运行 CLI typecheck/test 与 hello-fjs typecheck。
