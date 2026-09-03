# Plan: fjs run dev 端口自动递增

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 部分涉及 | CLI 只负责把实际端口写入 Flutter 宿主的 `FJS_DEV`；Web 运行时不涉及。 |
| II 边界即契约 | 不涉及 | 不改 UI op、natives 或事件类型。 |
| III 同步单线程零序列化 | 不涉及 | 不改 JS/Dart 执行模型。 |
| IV 外观照 WeUI | 不涉及 | 无 UI 外观变更。 |
| V 静默失效是 bug | 涉及 | 端口跳过时打印提示，最终 `FJS_DEV` 明确展示实际地址。 |
| VI 注释记录权衡 | 部分涉及 | 对端口探测上限和复用行为保留简短注释。 |
| VII 变更落到文档 | 涉及 | 更新 `docs/toolchain.md` 的 `fjs run` / dev server 说明。 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | `packages/fjs/src/commands/run.ts` | `startDevServer` 返回实际端口；冲突时递增重试。 |
| JS runtime | `packages/fjs-runtime/src/…` | 不涉及。 |
| Web 适配层 | `packages/fjs-runtime/src/web/…` | 不涉及。 |
| C++ 引擎 | `packages/flutter_fjs/native/src/…` | 不涉及。 |
| Dart 宿主 | `packages/flutter_fjs/lib/src/…` | 不涉及。 |
| 文档 | `docs/toolchain.md` | 记录 `fjs run` 端口自动递增行为。 |
| 测试 | `packages/fjs/test/run.test.ts` | 覆盖端口选择 helper。 |

## 3. 方案

把端口可用性判断抽成可测函数：从请求端口开始，最多向后探测一段范围。遇到同项目 fjs dev 时直接复用；遇到其他项目或其他进程时打印提示并继续尝试下一个端口。`startDevServer` 返回 `{ child, port }`，`runCommand` 用返回的 `port` 生成设备地址。

不让 `fjs dev` 自己自动递增：它是用户直接启动的长运行命令，端口冲突时明确失败更容易发现两个服务写同一个 outDir 的风险；本需求里的失败来自 `fjs run` 代拉 dev server 的路径。

## 4. 风险

- 如果递增后的端口被选中但设备地址仍用旧端口，Flutter 宿主会连错 server；通过测试和日志核对。
- 如果无限递增，环境异常时命令会卡住；用有限范围失败并说明尝试范围。
- 38901 同时也是 discovery UDP 端口，但 TCP dev server 和 UDP discovery 可共存，不冲突。

## 5. 验证路径

```bash
pnpm --filter @ufjs/cli test
pnpm --filter @ufjs/cli run typecheck
```
