# Spec: Flutter 宿主应用配置

- **ID**: 015-flutter-host-config
- **状态**: done
- **日期**: 2026-09-04

## 1. 要解决什么

`fjs run` 会在项目根目录下自动创建 `.fjs/flutter`，但项目无法通过源码配置
Flutter 宿主的 Android application id、iOS bundle identifier，以及运行时需要的
常用权限声明。用户每次重新生成宿主后都要手工修改原生工程，修改也容易在
`fjs clean --all` 后丢失。

## 2. 不做什么（Non-goals）

- 不配置 Android signing、iOS provisioning profile、证书或发布渠道。
- 不修改 Android `namespace`、Java/Kotlin 包目录或 iOS 工程 target 结构。
- 不为所有应用硬编码权限；权限必须由项目显式声明。
- 不改变 `fjs host eject` 后宿主的所有权和覆盖规则。

## 3. 用户可见的行为

项目根目录增加 `app.config.ts`，与 `package.json` 同级：

```ts
export default {
  android: {
    applicationId: 'com.acme.demo',
    permissions: [
      'android.permission.INTERNET',
      'android.permission.ACCESS_NETWORK_STATE',
    ],
  },
  ios: {
    bundleIdentifier: 'com.acme.demo',
    infoPlist: {
      NSCameraUsageDescription: '用于扫描二维码',
      NSLocalNetworkUsageDescription: '用于连接开发服务器',
    },
  },
};
```

执行 `fjs host create` 或 `fjs run android|ios` 时，managed `.fjs/flutter` 应：

- 把 Android `applicationId` 写入 `android/app` 的 Gradle 配置；
- 把 iOS `PRODUCT_BUNDLE_IDENTIFIER` 写入 Runner 工程及测试 target；
- 把 Android permissions 写入主 `AndroidManifest.xml`；
- 把 iOS `infoPlist` 键值写入 Runner `Info.plist`；
- 重复同步时只更新由 `app.config.ts` 管理的声明，不重复追加。

配置不存在或某个平台字段不存在时，保留 Flutter 默认值，不增加权限。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | 配置只作用于 Flutter 原生宿主工程 | Web 不读取、不模拟原生包名和权限 |
| 事件载荷 | 不涉及 | 不涉及 |
| 已知差异 | 这是平台工程配置，不是页面运行时能力，因此只存在于 Flutter 侧 | Web 没有对应的 Android/iOS manifest 或 Info.plist |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

## 6. 验收标准

1. `app.config.ts` 与 `package.json` 同级时，`fjs host create` 能按配置写入 Android
   application id、permissions 和 iOS bundle identifier、Info.plist。
2. 连续执行两次 `fjs host create` 不会重复写入权限或 plist 键。
3. 没有 `app.config.ts` 时，现有项目行为保持不变。
4. `fjs host eject` 后，`fjs run` 不覆盖宿主原生配置。
5. `fjs create` 生成的 Vue 和 TypeScript 项目都带有可编辑的 `app.config.ts` 示例。
6. `pnpm --filter @ufjs/cli run typecheck` 和 `pnpm --filter @ufjs/cli test` 通过。
7. `docs/toolchain.md` 说明配置格式、managed/eject 边界及 Android JDK 17 注意事项。

## 7. 待澄清

无。权限采用显式列表/键值映射，项目可按实际插件需求填写。
