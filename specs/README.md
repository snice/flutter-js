# specs/

spec-kit 产物目录。一个需求一个子目录，命名 `NNN-slug`（三位序号 + 短横线名）：

```
specs/
  001-css-media-query/
    spec.md     做什么、为什么、验收标准     ← /spec 生成
    plan.md     改哪些层、什么顺序           ← /plan 生成
    tasks.md    可勾选的任务清单             ← /tasks 生成
```

模板在 [`.specify/templates/`](../.specify/templates/)，工程宪法在
[`.specify/memory/constitution.md`](../.specify/memory/constitution.md)。

**续做规则**：新会话开始时先 `ls specs/`，有未完成的（tasks.md 还有没勾的）
就接着做，不要新开一个。完成的 spec 保留在仓库里，它是这个功能"为什么长这样"
的唯一记录。
