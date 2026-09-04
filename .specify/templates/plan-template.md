# Plan: <标题>

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | | |
| II 边界即契约 | | |
| III 同步单线程零序列化 | | |
| IV 外观照 WeUI | | |
| V 静默失效是 bug | | |
| VI 注释记录权衡 | | |
| VII JS 能包就不要下 Dart | | |
| VIII 变更落到文档 | | |

有条款要破例的，在这里写清理由；破不了的就改方案。

## 2. 涉及的层

从上往下列，标出每层要动什么：

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | `packages/fjs/src/…` | |
| JS runtime | `packages/fjs-runtime/src/…` | |
| Web 适配层 | `packages/fjs-runtime/src/web/…` | |
| C++ 引擎 | `packages/flutter_fjs/native/src/…` | |
| Dart 宿主 | `packages/flutter_fjs/lib/src/…` | |
| 文档 | `docs/…` | |

## 3. 方案

选定的做法，以及被否掉的备选和否掉的原因。

## 4. 风险

会静默失效的地方、需要两端对拍验证的地方。

## 5. 验证路径

```bash
# 具体命令序列
```
