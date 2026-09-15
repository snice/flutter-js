# Spec: app.config.ts 的 version 同步进宿主 pubspec

- **ID**: 055-app-config-version
- **状态**: done
- **日期**: 2026-09-15

## 1. 要解决什么

`app.config.ts` 里写了 `version` 字段（例如 `version: '1.0.0+1'`），但 CLI 不认识
它——`AppConfig` 类型和 `validateAppConfig` 的白名单都没有这个字段，配置被静默
丢弃。生成宿主 `.fjs/flutter/pubspec.yaml` 的 `version:` 行硬编码为 `1.0.0+1`，
应用想给 APK/IPA 定版本号，只能每次重新生成宿主后手工改 pubspec，改完还会在
下次 run/build 时被模板盖回去。

## 2. 不做什么（Non-goals）

- 不就地改写 eject 宿主的 pubspec——eject 后 pubspec 归用户所有，
  沿用"fjs 不重写"的既有约定（宪法 V 的边界不变）。
- 不直接写 Android `versionName/versionCode` 或 iOS
  `CFBundleShortVersionString`——Flutter 构建本来就从 pubspec version 推导
  它们，写 pubspec 一处即可。
- 不做 web / 小程序侧的版本同步——两者没有对应的版本概念。
- 不改动 `fjs host id`、`package.json` version 或其他版本来源的语义。

## 3. 用户可见的行为

```ts
// app.config.ts
import { defineConfig } from '@ufjs/cli/config';

export default defineConfig({
  version: '1.2.0+3',
});
```

之后任何会重建 managed 宿主的命令（`fjs run`、`fjs build --release`、
`fjs host create`、`fjs host sync`）生成的 `.fjs/flutter/pubspec.yaml` 都包含
`version: 1.2.0+3`。不配置 `version` 时保持现状（`1.0.0+1`）。

格式不符合 pubspec 版本规范（如 `abc`、`1.2`）时，加载配置直接报错并指出
字段与文件名，而不是等 `flutter pub get` 给出一个难懂的 YAML 错误。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | version 写入 managed 宿主 pubspec，flutter build 自动带到 Android/iOS 版本号 | 不读取 version |
| 事件载荷 | 不涉及 | 不涉及 |
| 已知差异 | 这是宿主工程配置，同 spec 015，只存在于 Flutter 侧 | Web 构建无版本产物 |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

## 6. 验收标准

1. `app.config.ts` 配 `version: '1.2.0+3'` 时，`fjs host create` 后
   `.fjs/flutter/pubspec.yaml` 的 version 行是 `1.2.0+3`。
2. 不配置 `version` 时，生成的 pubspec 保持 `version: 1.0.0+1`，现有项目行为不变。
3. `version: 'abc'` 会让配置加载报错，错误信息含文件名和字段名。
4. `pnpm --filter @ufjs/cli run typecheck` 和 `pnpm --filter @ufjs/cli test` 通过。
5. `docs/toolchain.md` 说明 version 字段及其 managed/eject 边界。

## 7. 待澄清

无。默认值维持现有硬编码 `1.0.0+1`，格式校验对齐 pubspec 自身的版本语法。
