# Plan: app.config.ts 的 version 同步进宿主 pubspec

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 否 | 宿主工程配置，同 015 的先例，Web 无对应物 |
| II 边界即契约 | 否 | 不动 op 协议、JSI、事件 |
| III 同步单线程零序列化 | 否 | 纯 CLI 文本生成 |
| IV 外观照 WeUI | 否 | 不涉及 UI |
| V 静默失效是 bug | 是 | version 校验失败要报错而不是丢弃；eject 宿主不静默盖用户版本 |
| VI 注释记录权衡 | 是 | `AppConfig.version` 的注释写清"为什么只写 pubspec"（flutter build 会向下传播） |
| VII JS 能包就不要下 Dart | 否 | 不涉及运行时能力 |
| VIII 变更落到文档 | 是 | `docs/toolchain.md`、`docs/roadmap.md` |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | `packages/fjs/src/project/config.ts` | `AppConfig` 加 `version`；`validateAppConfig` 白名单加分支 |
| CLI / 构建 | `packages/fjs/types/config.d.ts` | 镜像 `AppConfig` 加 `version` |
| CLI / 构建 | `packages/fjs/src/commands/run.ts` | `writeHostPubspec` 加 version 参数并在模板插值；调用点传 `appConfig.version` |
| 测试 | `packages/fjs/test/config.test.ts`、`packages/fjs/test/run.test.ts` | 校验与生成 pubspec 的用例 |
| 文档 | `docs/toolchain.md`、`docs/roadmap.md` | 字段说明与清单补笔 |

## 3. 方案

`writeHostPubspec` 是 managed 宿主 pubspec 的唯一生成点（内嵌模板，每次
run/build 整体重写），给它加第 4 个参数 `version = '1.0.0+1'` 并在模板插值，
调用点 `ensureFlutterHost` 把 `appConfig.version` 传进去（undefined 走默认）。
这一处改动天然覆盖 `fjs run`、`fjs build --release`、`fjs host create/sync`，
eject 分支不经过它，所有权规则不变。

被否掉的备选：

- **像 `syncNativeHostConfig` 那样对已生成 pubspec 做正则就地替换**——pubspec
  本来就整体重写，再加一个替换步骤是重复机制，还会在 ejected 场景引入"要不要
  替换用户文件"的新问题。
- **把 version 写进 AndroidManifest/Info.plist**——Flutter 构建已从 pubspec
  推导 Android `versionName/versionCode` 与 iOS `CFBundleShortVersionString`，
  直接写 pubspec 是最小且不重复的注入点。

## 4. 风险

- 校验过松：非法版本要到 `flutter pub get` 才炸，错误难懂 → `validateAppConfig`
  用 pubspec 版本语法的正则前置拦截，报错带文件名与字段名。
- 老项目没配 version：默认值与旧硬编码一致（`1.0.0+1`），行为零变化。
- `types/config.d.ts` 漏改会让 `defineConfig` 用户拿不到类型提示 → 与
  `config.ts` 同一提交内同步。

## 5. 验证路径

```bash
pnpm --filter @ufjs/cli run typecheck
pnpm --filter @ufjs/cli run test
pnpm test
cd examples/hello-fjs && node -e "…"   # readAppConfig 解析现有 app.config.ts，确认 version 出来
```
