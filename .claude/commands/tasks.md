---
description: 把 plan 拆成可勾选的任务清单，产出 tasks.md
---

针对当前 spec 目录的 `plan.md`。

1. 按 [tasks-template.md](../../.specify/templates/tasks-template.md) 写
   `specs/NNN-slug/tasks.md`。
2. 排序原则：**契约层先行**（op 协议 / natives / 事件类型），
   因为 JS 侧和 Dart 侧都依赖它；然后实现，然后 Web 对齐，
   然后测试，最后文档。
3. 每条任务：一句祈使句 + 涉及的文件路径。粒度是"一次能做完并验证的改动"。
4. 「两端对齐」和「文档」两组不许省略 —— 宪法 I 和 VII。
5. 最后一组固定是验收：typecheck、test、逐条核对 spec 第 6 节。

写完问用户是否 `/implement`。
