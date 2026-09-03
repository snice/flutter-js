# Spec: fjs run dev 端口自动递增

- **ID**: 004-dev-port-auto-increment
- **状态**: done
- **日期**: 2026-09-03

## 1. 要解决什么

`fjs run android|ios` 默认会启动 `fjs dev --pages --port 38900`。当 38900 已经被另一个
fjs dev 项目或其他进程占用时，命令直接失败，例如：

```text
fjs: port 38900 is already used by another fjs dev project: /Volumes/zt/Documents/flutter-js/examples/hello-fjs
```

用户希望端口被占用时自动尝试下一个端口，避免每次手动传 `--port 38901`。

## 2. 不做什么（Non-goals）

- 不修改 `fjs dev` 单独运行时的显式端口冲突处理。
- 不杀掉或接管已经存在的其他项目 dev server。
- 不改变 release / profile 模式；这些模式不启动 dev server。
- 不新增依赖。

## 3. 用户可见的行为

当默认端口被其他项目占用时：

```bash
fjs run ios
```

命令会提示 38900 被占用并尝试 38901。如果 38901 可用，就启动：

```text
FJS_DEV=127.0.0.1:38901
```

当端口被同一个项目的 fjs dev 占用时，继续复用已有 server，端口不变。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | `fjs run` 传入实际选中的 `FJS_DEV=<host:port>` | 不涉及 |
| 事件载荷 | 不涉及 | 不涉及 |
| 已知差异 | CLI 行为，只影响 Flutter 宿主 dev 连接 | 不涉及 |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

## 6. 验收标准

1. `fjs run` 发现请求端口被另一个 fjs dev 项目占用时，会自动尝试 `port + 1`。
2. `fjs run` 发现请求端口被非 fjs 进程占用时，会自动尝试 `port + 1`。
3. `fjs run` 复用同项目已有 fjs dev server 时，仍使用原端口。
4. `FJS_DEV` 使用最终选中的端口，而不是最初请求的端口。
5. `pnpm --filter @ufjs/cli test` 通过。
6. `pnpm --filter @ufjs/cli run typecheck` 通过。

## 7. 待澄清

- [x] 无
