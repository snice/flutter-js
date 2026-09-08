# Spec: iOS 真机 WebGL 呈现 + release 下 fetch 资产

- **ID**: 026-ios-device-webgl-and-release-fetch
- **状态**: in-progress
- **日期**: 2026-09-08
- **前置**: 021（webgl 模块）、023（three.js/glTF，T035 把 iOS 真机空白记为上游遗留）

## 1. 要解决什么

两件独立的事，同一轮设备验证里一起暴露：

1. **iOS 真机 webgl 空白**。Android 真机、iOS 模拟器、web 都已出图；
   只有 iOS 真机（FlutterAngleOSPlugin 路径）画布无输出。flutter_angle
   0.4.2 在真机走的是 IOSurface→`eglCreatePbufferFromClientBuffer` 的 EGL
   呈现路径（模拟器走 `openglTexture`+FBO 路径，两端机制完全不同），
   EGL surface 建失败时插件只打一条 console 就继续用空 surface 渲染，
   表现为静默黑屏（spec 023 T035 已记）。
2. **release 下 fetch 根相对 URL 失败**。`fetch('/assets/x.glb')` 在 dev
   由 dev server 解析（spec 023 T015），release 无 dev server 时
   `FjsHttp._resolveRelative` 直接抛 FormatException reject。而 `<image>`
   （spec 017）和 `<web-view>`（spec 014）都有 release 资产分支——fetch
   是唯一没有的一端，同一个 URL 在 image 上能显示、fetch 里报错。

## 2. 不做什么（Non-goals）

- 不 fork / 修补 flutter_angle 上游（真机 EGL 路径若确属插件缺陷，先在本
  仓库侧把失败显性化并给用户可操作的诊断输出，上游问题记录在案）。
- fetch 的 release 分支只覆盖**根相对路径**（`/x`，即 `public/` 与 Vite
  产出的 `/assets/*`，两者在 release 都落在 `assets/fjs/public/` 下，
  build.ts `syncPublicAssets`）。`asset://` scheme、写权限、Range 请求
  不做。
- 不改 JS 侧 fetch API 形状（仍是标准 Response）。

## 3. 用户可见的行为

- release 包里 `fetch('/assets/Xbot-<hash>.glb')` 返回 200 + 正确字节；
  文件缺失时 resolve 一个 `ok: true, status: 404` 的 Response（与浏览器
  行为一致，不 reject）。
- iOS 真机：webgl 画布要么出图，要么在控制台打出**明确的失败原因**
  （EGL surface 创建失败 / 纹理创建失败），不再静默黑屏。

## 4. 验收标准

1. `pnpm test` 与 `pnpm -w run typecheck` 全过；http.dart 新增单测覆盖
   release 资产分支（命中/404/带查询串）。
2. release 构建（`build:release`）装真机：手写 GLB 查看器模型加载、渲染、
   拖拽全通（fetch 修复的直接受益者）。
3. iOS 真机打开 `/example/webgl`：出图，或控制台给出定位到具体环节的
   失败日志（本轮至少完成诊断闭环）。

## 5. 风险

- 真机 EGL 路径的修复依赖设备反馈，本轮可能只交付"显性化 + 诊断"，
  修复落到下一轮（与 023 T035 同源）。
- rootBundle 读大资产（GLB 2.9MB）在主 isolate 解码，量大时可考虑
  后续优化，不在本 spec。
