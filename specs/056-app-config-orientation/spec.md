# Spec: app.config.ts 的屏幕方向锁定

- **ID**: 056-app-config-orientation
- **状态**: done
- **日期**: 2026-09-15

## 1. 要解决什么

racing 示例（`examples/racing/`，three.js 赛车游戏）在 Android/iOS 真机上以竖屏
握持时会得到竖着挤压的画面，游戏必须横屏。仓库目前没有任何一层做方向控制：
CLI 不碰 manifest/plist 的方向声明，Dart 侧也没有 `setPreferredOrientations`。
用户只能每次重新生成宿主后手工改 `AndroidManifest.xml` 和 `Info.plist`，改完
还会在宿主重建时丢掉。

## 2. 不做什么（Non-goals）

- 不做 web 端方向控制——浏览器的 Screen Orientation API 需要 fullscreen 授权，
  且 web 构建没有宿主工程可配。
- 不做小程序 `pageOrientation` 透传——mp 管线的 `appJson()` 目前不生成 window
  配置，透传通道本身是另一个独立需求。
- 不提供 Android 独有的全部 `screenOrientation` 枚举值（`fullSensor`、
  `behind` 等），只提供跨平台语义对齐的 `portrait` / `landscape`。
- 不做取消配置后的自动还原——manifest 的 activity 属性无法用 marker 标注，
  恢复默认走 `fjs clean` 重新生成宿主（文档写明）。
- 不改 Dart 侧运行时（`SystemChrome.setPreferredOrientations`）——原生声明在
  启动画面阶段就生效，比 Flutter 运行时更早，且与 spec 015 的宿主配置哲学一致。

## 3. 用户可见的行为

```ts
// app.config.ts
import { defineConfig } from '@ufjs/cli/config';

export default defineConfig({
  orientation: 'landscape',
});
```

之后 managed 宿主（`fjs run`、`fjs build --release`、`fjs host create/sync`）
的原生工程被锁定：

- Android：MainActivity 的 `<activity>` 获得 `android:screenOrientation`，
  `landscape` 映射 `sensorLandscape`（正反两个横屏方向都允许，与 iOS 行为
  对齐），`portrait` 映射 `portrait`；
- iOS：`Info.plist` 的 `UISupportedInterfaceOrientations` 与
  `UISupportedInterfaceOrientations~ipad` 被改写为对应方向集合，并自动写入
  `UIRequiresFullScreen: true`——`TARGETED_DEVICE_FAMILY` 含 iPad 时，不退出
  多任务则方向锁静默失效，这个键是方向锁生效的前提；
- 不配置 `orientation` 时，原生文件完全不动（保持 flutter create 默认）；
- 重复同步幂等；`ios.infoPlist` 里用户显式配置的同名键仍可覆盖
  `UIRequiresFullScreen`。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | 原生工程方向声明，App 启动即锁定 | 不读取、不模拟 |
| 事件载荷 | 不涉及 | 不涉及 |
| 已知差异 | 同 spec 015：宿主工程配置，仅 Flutter 侧 | 浏览器无宿主工程；CSS `@media (orientation)` 仍可用于响应式（spec 043） |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

## 6. 验收标准

1. `app.config.ts` 配 `orientation: 'landscape'` 后，`fjs host create` 生成的
   manifest 有 `android:screenOrientation="sensorLandscape"`，plist 两组方向
   数组只含 LandscapeLeft/Right，且带 `UIRequiresFullScreen`。
2. `portrait` 同理（`portrait` + Portrait）。
3. 连续两次同步结果一致（幂等）；`portrait` 与 `landscape` 之间切换能覆盖旧值。
4. 不配置 orientation 时，现有项目生成的 manifest/plist 与改动前逐字节一致。
5. `orientation: 'abc'` 让配置加载报错，错误信息含文件名与字段名。
6. `pnpm --filter @ufjs/cli run typecheck` 和 `pnpm --filter @ufjs/cli test`、
   `pnpm test` 通过。
7. `docs/toolchain.md` 说明 orientation 字段、映射与还原方式。

## 7. 待澄清

无。landscape 取 sensorLandscape（两个横屏方向）是横屏游戏的标准语义，也与
iOS 方向数组的行为天然一致。
