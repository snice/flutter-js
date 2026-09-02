---
description: 按 tasks.md 顺序落地，逐条勾选
---

执行当前 spec 目录的 `tasks.md`。

1. 从第一个未勾选的任务开始，**按顺序**做。
2. 每完成一条：改 `tasks.md` 把 `- [ ]` 改成 `- [x]`，再做下一条。
3. 每改一处对照 [constitution.md](../../.specify/memory/constitution.md)：
   - 动了 op 协议？`ops.ts` 和 `ui_ops.dart` 都改了吗
   - 加了能力？web 侧实现了吗，事件载荷是字符串吗
   - 改了默认外观？两端数值一致吗，对齐 WeUI 了吗
4. 遇到 plan 没预料的情况：停下，说明，更新 plan.md 和 tasks.md，再继续。
   不要偷偷改方案。
5. 全部勾完后跑验收命令，把真实输出贴出来。失败就说失败，不要含糊。
6. 最后把 spec.md 的「状态」改成 `done`。
