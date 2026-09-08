# Plan: spec 026

## 1. fetch 的 release 资产分支（packages/flutter_fjs/lib/src/http.dart）

`_run` 里 `raw.isAbsolute == false` 时：

- dev server 在 → 现行为（`base.resolve`），不动。
- dev server 不在（release / 未连 dev）→ 新分支 `_sendReleaseAsset(raw)`：
  - 路径规则与 image.dart `fjsResolveImageSource` 完全一致：去开头 `/`、
    剥 query/fragment、拒 `..`，拼 `assets/fjs/public/<path>`。
  - `rootBundle.load` 命中 → `{ok: true, status: 200, headers: 按
    扩展名给 content-type, bodyBase64}`；未命中 → `{ok: true,
    status: 404}`（fetch 语义：404 是 resolve 不是 reject）。
  - 现有的 FormatException 报错文案删除（两个分支覆盖了它的全部语义）。
- flutter_fjs 已依赖 flutter/services（镜像树就用了 rootBundle 之外的
  services），无需新依赖。
- 单测：新建 `test/http_release_asset_test.dart`，用 TestWidgetsFlutterBinding
  +AssetBundle 注入假资产（flutter test 环境没有 assets，用
  `TestDefaultBinaryMessenger` 拦 `flutter/assets` 消息或自造 bundle），
  覆盖命中 / 404 / 带查询串 / `..` 拒绝。

## 2. iOS 真机 EGL 失败显性化（packages/fjs-webgl/flutter/lib/src/replay.dart）

flutter_angle 0.4.2 真机路径：`createTexture` 后 Dart 侧
`_createEGLSurfaceFromIOSurface` 失败时把 `surfaceId` 留空继续跑 →
`activate()` 绑 FBO 0（无附着）→ 全部绘制被丢弃 → 静默黑屏。
模拟器不受影响（`initOpenGL` 回 `isSimulator: true` 使 Dart 走 FBO 路径）。

本轮改动（不 fork 上游）：

- `_createTexture` 成功返回前，在 Apple 平台检查 `texture.surfaceId`：
  为空指针 → `state.failed = true` + debugPrint 一条带定位信息
  （"ANGLE could not build an EGL surface from the plugin's IOSurface —
  rendering would go nowhere"）。黑屏变成一次可读的失败。
- `_drain` 里 `updateTexture` 前后各打一次（仅首次）诊断：
  surfaceId 是否非空、textureId，帮助设备日志定位环节。
- 文档：docs/canvas-compat.md 记 iOS 真机为"待设备复验"，上游差异
  （真机 IOSurface 路径 vs 模拟器 Metal/FBO 路径）写进 023 T035 的
  追加记录与本 spec tasks。

## 3. 顺序

1. http.dart + 测试（独立，先做先验）。
2. replay.dart 诊断（改完需重编安装 app 才生效，用户设备验证）。
3. 用户真机轮次：按日志决定是否进入"真修"（可能需要给 flutter_angle
   提 issue/本地 patch）。
