# Tasks: webgl 呈现路径收口

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

> **本 spec 的特殊情况**：代码是在真机排查过程中先写出来的（四条缺陷是靠
> 一轮轮设备实验才分离开的，没法先写 spec 再动手）。已经落在工作区、且已被
> 设备验证过的条目**在这里直接勾上并注明验证方式**；没做的照常留空。
> 不要因为「代码已经在了」就把没验证的也勾掉 —— 尤其 T033/T034/T035。

## 契约层（先做，后面都依赖它）

- [x] T001 确认三张契约表都不动：op 协议（`fjs-runtime/src/ui/ops.ts` +
      `flutter_fjs/lib/src/ui_ops.dart`）、natives 表、事件类型均无改动。
      模块内部 API 变更（`markFrameAvailable` → `layerReady`、新增 `present`）
      的调用方只有同包的 `FjsWebglCanvasView`，不跨 JSI/FFI 边界。
      → plan §1 II 行已核对

## 实现

- [x] T010 `packages/fjs-webgl/flutter/lib/src/replay.dart`：`_NodeGlState`
      加 `creation` / `needsPresent` / `layerLive` / `boundSincePresent` 四个字段
- [x] T011 同上：`pump()` 改为 await `_createTexture`，并发 pump 共享同一个
      `state.creation` future（缺陷 1）
- [x] T012 同上：`_drain()` 只执行不呈现，末尾置 `needsPresent` 并
      `_schedulePresent`（缺陷 2 的前半）
- [x] T013 同上：新增 `present()` —— swap 前先 `_drainIfPending` 把同一页面帧
      稍后到达的后半批拉进同一个后缓冲（缺陷 3），一帧至多 swap 一次（缺陷 2），
      且要求 `layerLive`（保住 026 的原意）
- [x] T014 同上：新增 `_activate()` —— 一帧内不重绑、跨 present 必重绑；
      `_freeTexture` 在 `await` 两侧都清 `_activeNode`（plan §3.4）
- [x] T015 同上：新增 `_syncAppleSurface()` —— Apple + 设备 surface 路径
      （`fboId == 0` 且 `surfaceId` 有效）在 swap 前做一次 1×1 `readPixelsRgba`
      强制同步（缺陷 4）；删掉 `markFrameAvailable`
- [x] T016 `packages/fjs-webgl/flutter/lib/fjs_webgl.dart`：pump 的
      `whenComplete` 只留 setState；新增 `_scheduleLayerReady()`，在 `build` 里
      `id != null` 时挂一次 post-frame 回调 `FjsWebglRuntime.layerReady`
- [x] T017 `packages/fjs/src/commands/run.ts`：plist 段的 `values` 改为
      「默认键 + 用户 `ios.infoPlist` 展开覆盖」，默认注入
      `NSLocalNetworkUsageDescription`（缺陷 5）
- [x] T018 `examples/hello-fjs/src/pages/example/gltf-viewer.vue`：修
      `autoSpin`（ref 当裸值判断恒真、`yaw += 0.01` 写了两遍、按需渲染下不给
      自己排下一帧）
- [x] T019 清掉排查期间加的 `[dbg]` 日志（replay.dart 与 fjs_webgl.dart 共 7 处）
      与示例页的临时红色背景

- [x] T01A **补注释**：T013/T014/T015 三处必须写明「为什么这样而不是那样」
      **并带上实测证据**（宪法 VI）——
      EGL `EGL_BUFFER_DESTROYED` 为什么让第二次 swap 有害；
      swap 前读到中心 `(174,109,103)` / 角落 `(209,214,219)` 如何证伪了
      `glFinish` 在 ANGLE Apple 后端有效这个说法；
      `_activate` 两个方向各自的反例（不重绑 → iOS 全空；帧内重绑 → Android
      平铺），否则以后任何一次「简化」都会打回其中一边。
      现有注释已覆盖大部分，逐条复核一遍别漏

## 两端对齐

> web 侧**没有对应实现要写**：`getContext('webgl')` 在 web 上直接交还浏览器
> 原生 context（`packages/fjs-runtime/src/web/components/canvas.ts:15-16`），
> 呈现是浏览器的事，fjs 这侧没有 present 路径。这一组因此只剩「对拍」。
> 不省略这一组是因为宪法 I 要求把「做不到两端一致的地方」写明理由。

- [x] T020 `pnpm --filter hello-fjs run dev:web`：三个 webgl 页
      （glTF 手写 / three.js glTF / WebGL 三角形）行为不回归
- [x] T021 两端对拍：同一份页面源码，web 与 Android/iOS 真机上
      「加载完不碰屏幕即出图、且只出一个模型」表现一致

## 测试

- [x] T030 `packages/fjs/test/run.test.ts`：加两条断言 —— 没有 `ios.infoPlist`
      配置时默认键也写进 managed block；用户配了同名键时覆盖默认值
- [x] T031 `packages/fjs-webgl/flutter/test/webgl_replay_test.dart`：加
      `layerReady` 在无纹理节点上既不抛异常也不呈现的用例
- [x] T032 **在 tasks 与代码注释里显式记下可测边界**（宪法 V：测试跳过要
      显式说明）：`pump` / `present` 需要真的 `FlutterAngle`，widget 测试里
      没有，所以**「一帧一次 present」「drain-before-present」「Apple 同步」
      这三条不变量是设备验证的，不是单测覆盖的**。别让 `flutter test` 全绿
      被读成呈现路径有回归保护

- [x] T033a **Android 真机回归 · RMX3700 / Android 16（API 36）**：走的是有
      fence 的那条 SurfaceProducer 路径，之前完全没测到。最终版实测通过 ——
      手写 glTF 免触摸直接出图、只有一个模型、无平铺；three.js glTF 正常；
      WebGL 三角形持续旋转 60fps；手写 ↔ three.js 来回切 3 次每次都正常
- [x] T034 **iOS 真机确认（最终版）**：探针换成 `_syncAppleSurface` 之后的
      最终版实测通过 —— 三个 webgl 页各一次、手写 ↔ three.js 来回切 3 次
      （日志里 key=1..9），全程无 `加载失败` / 无异常，
      `first present on node 251 — eglSurface live`
- [x] T035 **iOS 模拟器验证**：FBO 路径（与真机机制不同，026 spec §1 强调过）
      实测通过 —— 手写 glTF / three.js glTF 免触摸直接出图，WebGL 三角形持续旋转
- [x] T036 首次装机的本地网络权限：删掉 app 重装，确认系统正常弹询问，允许后
      日志出现 `[dev] preloaded N page chunks`、无 `No route to host`。
      实测：`preloaded 40 page chunks`，全程无 `No route to host`

## 文档

- [x] T040 `docs/canvas-compat.md` L73 iOS 真机那段**改写**：删掉 026 的错误
      归因「present 前显式 `glFinish`」，换成「swap 前一次 1×1 读回强制同步」，
      并补「一帧只 present 一次」「执行与呈现是两个时钟」
- [x] T041 `docs/threading-model.md` 新增一节：GL 命令的**执行**与**呈现**分属
      两个时钟 —— 执行随 chunk 到达（含 JS 同步查询触发的中途 drain），呈现每
      Flutter 帧一次且在 `Texture` layer 就绪后。说明页面在 `draw()` 中途做 GL
      查询为什么现在是安全的
- [x] T042 `docs/toolchain.md` 的 `infoPlist` 节（L271-290）补：`fjs run ios`
      自动注入哪些默认键、为什么（iOS 14+ 无此键直接拒绝局域网且不弹窗）、
      怎么用 `app.config.ts` 覆盖
- [x] T043 `docs/roadmap.md`：026 条目补一句被 028 修正
- [x] T044 `specs/026-ios-device-webgl-and-release-fetch/`：状态转 `done`，
      T007 记「真机验证不通过，原因与修正见 028」

## 验收

- [x] T050 `flutter analyze` 无 issue；`flutter test` 13 passed
- [x] T051 `packages/fjs`：`tsc --noEmit` 通过、`vitest run` 96 passed（10 files）；
      `hello-fjs` `vue-tsc --noEmit` 通过；`pnpm test` 全过
- [x] T052 spec.md 第 6 节 15 条逐条核对：
      1-4 静态全过；5-8 Android 真机（RMX3700 / API 36）全过；
      9 iOS 真机全过（用户目视确认）；10 `preloaded 40 page chunks`、无
      `No route to host`；11 `Info.plist` grep 命中（L70）；
      12 iOS 模拟器三页全过；13 web 三页全过；14-15 文档已改
- [x] T053 spec.md 状态转 `done`

## 后续（不属于本 spec 的交付，但别忘）

- [ ] T033b **第二台 Android 真机覆盖 · 红米 Note 9 Pro / Android 12（API 31）**：
      走的是 `ImageTextureEntry can't wait on the fence on Android < 33` 那条
      路径，与 T033a 的 API 36 不同。spec §6 的验收 5-8 只要求「Android 真机」，
      T033a 已满足；这一条是 plan §4 额外加的设备覆盖，不是本 spec 的交付项。
      这台上验过的是**带调试日志的中间版本**，最终版没重跑（设备中途拔掉了）。
      接回来补一次，检查项同 T033a
- [ ] T060 iOS 真机每帧一次 1×1 `readPixels` 的代价实测（spec 待澄清 1）。
      按 027 的方法做同一次会话、同样负载的 A/B，量连续渲染页的帧间隔。
      它替换的是 026 每帧一次 `glFinish()`，同类开销不是净增，所以本轮没做
- [ ] T061 还原真机上为调试改的系统设置（`svc power stayon`、熄屏时长）。
      RMX3700 已还原（stayon=false、熄屏 60s）；**红米那台还没还原**
      （`svc power stayon true` + 熄屏 10 分钟），接回来时一起做
