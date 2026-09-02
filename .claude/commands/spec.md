---
description: 写需求规格。每个会话的第一步，产出 specs/NNN-slug/spec.md
argument-hint: <一句话需求>
---

为 `$ARGUMENTS` 建立规格。

1. `ls specs/` 看有没有未完成的 spec（`tasks.md` 还有没勾的条目）。
   有且与本次需求相关 → 读它，接着做，**不要新建**；无关 → 继续第 2 步。
2. 读 [.specify/memory/constitution.md](../../.specify/memory/constitution.md)。
3. 取下一个序号，建 `specs/NNN-slug/spec.md`，用
   [.specify/templates/spec-template.md](../../.specify/templates/spec-template.md) 的结构。
4. 读相关源码把「用户可见的行为」和「两端约定」写实 —— 不要凭想象写 API 形状，
   对着 `packages/fjs-runtime/src/tags.ts`、`docs/ui-api.md`、
   `docs/css-compat.md` 核对现状。
5. 「验收标准」每条必须能对应一条命令或一次可观察的操作。
6. 有拿不准的地方写进「待澄清」并**直接问用户**，不要自己拍板。

写完把 spec.md 的要点摘给用户，问一句是否进入 `/plan`。不要在这一步写任何代码。
