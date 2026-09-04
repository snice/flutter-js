# Plan: Flutter 宿主应用配置

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是，平台工程配置 | 明确记录为 Flutter 原生工程配置，Web 不存在对应契约 |
| II 边界即契约 | 否 | 不经过 JS/Dart/C++ 运行时边界 |
| III 同步单线程零序列化 | 否 | CLI 在生成宿主时读取配置并写文件 |
| IV 外观照 WeUI | 否 | 不涉及组件外观 |
| V 静默失效是 bug | 是 | 配置文件语法、字段和权限值在 CLI 侧校验并报错 |
| VI 注释记录权衡 | 是 | 记录 managed 标记块和不修改 namespace 的原因 |
| VII JS 能包就不要下 Dart | 否 | 不新增运行时能力 |
| VIII 变更落到文档 | 是 | 更新 `docs/toolchain.md` 和模板 README |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | `packages/fjs/src/project/config.ts` | 读取根目录 `app.config.ts` 并定义配置类型 |
| CLI / 构建 | `packages/fjs/src/commands/run.ts` | 生成/同步 Android 与 iOS 原生配置 |
| CLI / 构建 | `packages/fjs/src/commands/create.ts` | 新项目生成配置示例并纳入类型检查 |
| 测试 | `packages/fjs/test/config.test.ts`、`run.test.ts` | 配置读取、原生声明幂等更新 |
| 文档 | `docs/toolchain.md`、模板 README | 使用方式和生命周期说明 |
| 规范 | `specs/015-flutter-host-config/*` | 需求、方案、任务记录 |

## 3. 方案

根目录支持 `app.config.ts`，由 CLI 使用已存在的 `esbuild` 在运行时转译并加载，
避免新增配置加载依赖。配置是普通 default export 对象：

- `android.applicationId` 和 `android.permissions`；
- `ios.bundleIdentifier` 和 `ios.infoPlist`。

宿主每次 managed 同步时：

1. 保留 Flutter 生成的原生文件主体；
2. 删除上一次由 FJS 标记的配置块；
3. 将本次配置写入标记块；
4. 对 identity 使用现有 Gradle/pbxproj 文本替换逻辑。

不选择把配置继续放进 `package.json`：原生应用配置与 npm 依赖清单生命周期不同，
独立文件更容易被 Flutter/原生工程使用者发现和维护。也不选择直接让用户修改
`.fjs/flutter`：该目录是可丢弃的 managed 产物。

## 4. 风险

- iOS plist 是 XML，写入值必须做 XML 转义，并限制为 plist 基础值；
- Android manifest 只接受安全的 permission name，不能把任意 XML 拼进属性；
- Flutter 生成的 Gradle 文件可能是 `.gradle` 或 `.gradle.kts`，两者都要支持；
- 配置只在 managed host 生效；eject 后必须保持现有宿主不被覆盖。

## 5. 验证路径

```bash
pnpm --filter @ufjs/cli run typecheck
pnpm --filter @ufjs/cli test
pnpm test
```

通过临时宿主文件调用导出的 patch helper，确认 Android/iOS 配置重复同步后的文件
内容仍只有一份。
