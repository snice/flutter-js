# Tasks: spec 026

- [x] T001 spec/plan/tasks 落盘
- [x] T002 http.dart：release 根相对 fetch → `assets/fjs/public/*`，
      404 语义（resolve 不 reject），query/fragment 剥离，`..` 拒绝
- [x] T003 flutter_fjs 新增 http release 资产单测（命中/404/查询串/`..`）
- [x] T004 fjs-webgl replay.dart：Apple 平台 surfaceId 为空 → failed +
      定位日志；首帧 updateTexture 诊断日志
- [x] T005 `pnpm -w run typecheck` + `pnpm test` + `cd packages/flutter_fjs && flutter test` 全过
- [x] T006 docs：canvas-compat.md iOS 真机现状；023 tasks 追记上游机制差异
- [x] T007 用户真机验证：**不通过**（2026-09-10）。iPhone 上手写 GLB 查看器
      画布全空、three.js 查看器正常；Android 真机则是加载完不显示、拖一下才
      出来。原因不在真机 EGL 路径本身（不需要本地 patch，也不是上游 issue）：
      本 spec 的两处补偿其中一处是错的、另一处不够 ——
      - 补呈现（挂载后再 mark 一次）实际是**一帧 swap 两次**，EGL 默认
        `EGL_BUFFER_DESTROYED`，第二次推的是已丢弃的缓冲；
      - present 前的 `glFinish` **在 ANGLE 的 Apple 后端并不等待**，swap 前
        读像素证伪：画面全空时中心已是模型色 (174,109,103)。
      修正见 **spec 028（webgl 呈现路径收口）**，四条缺陷在那里一并收口，
      Android / iOS 真机均已实测通过。

## 设备轮次追加（2026-09-08）

- [x] T008（用户真机轮次 1）release 加载 GLB 直接抛
      `TextDecoder is not defined`：手写查看器 `src/gltf/glb.ts` 用了
      `new TextDecoder()`（QuickJS 无此全局；three 页面自带 polyfills 所以
      只有这个页面在 release 裸奔）。改用 runtime 导出的 `utf8Decode`
      （spec 023 T012 正是为这类调用方导出的）。

## iOS 真机轮次（2026-09-08 晚，设备 iPhone 12 / iOS 26.6，flutter 3.41.9）

- [x] T010 真机黑屏根因定位（对照实验链）：
      1. `glClear` process() 与直接打开 ANGLE libGLESv2 解析地址相同 →
         排除 GL 符号被 Apple OpenGLES 劫持；
      2. present 后 readPixels：全幅 900x660，非背景像素 98516 个
      （绿色渐变即三角形本体）→ GL 全链路正常，内容就在 surface 里；
      3. 呈现间隔打点：120 帧 p50=16ms / p95=18ms → 出帧节奏稳定 60fps。
      结论：黑屏在 Flutter 合成侧——`_drain` 的首帧
      markTextureFrameAvailable 落在 Texture layer 尚未挂载的帧上，
      静态/按需渲染页错过这次通知后永远不再显示。
- [x] T011 修复：`FjsWebglRuntime.markFrameAvailable(nodeId)` +
      `FjsWebglCanvasView` 在 pump 完成的 setState 之后追加一次
      post-frame 补 mark（layer 已存在，通知必达）。真机验证：三角形
      显示 ✓。保留：surface 缺失显性化检查、first-present 日志。
      待确认：旋转匀速性（GL 侧 60fps 已证，剩余疑点在 debug/无线
      调试的体感）。
- [x] T012（真机复验）清理临时诊断后回归黑屏 → 定位：此前"能用"依赖
      调试 readPixels 的副作用（强制同步 Metal 命令缓冲）；正式修法：
      `_drain` 在 `updateTexture`（eglSwapBuffers + frameAvailable）前
      显式 `bindings.finish()`（glFinish），确保 GL 绘制落进 IOSurface
      再通知合成器。模拟器 FBO 路径与 Android SurfaceProducer 不受
      影响（空队列 finish 是 no-op）。
- [x] T013 真机最终验证（用户确认）：三角形显示 ✓、匀速旋转 ✓。
      iOS 真机 WebGL 修复完成（markFrameAvailable 补通知 + present 前
      glFinish 双修）。
