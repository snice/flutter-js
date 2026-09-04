---
description: 把当前 spec 翻译成分层实现方案，产出 plan.md
---

针对最近一个 `状态: draft|ready` 的 `specs/NNN-slug/spec.md`（有歧义就问用户是哪个）。

1. 读 spec.md 和 [constitution.md](../../.specify/memory/constitution.md)。
2. spec 的「待澄清」还有未答条目 → 先问，别开始。
3. 按 [plan-template.md](../../.specify/templates/plan-template.md) 写
   `specs/NNN-slug/plan.md`。
4. **宪法自查表必须逐条填**，尤其：
   - I 两端同源：Flutter 和 Web 分别改哪个文件？
   - II 边界即契约：三张表动了哪张？对侧文件写出来。
   - VII JS 能包就不要下 Dart：这个能力为什么必须落 Dart？（能在
     `fjs-runtime/src/components/` 包成组件的就别下去）
   - VIII 文档：`docs/` 下哪几个文件要跟着改？
5. 「涉及的层」表里每个条目要写到具体文件路径，靠 Grep/Read 确认路径真实存在。
6. 写下被否掉的备选方案和否掉的原因。

写完摘要给用户，问是否进入 `/tasks`。仍然不写生产代码。
