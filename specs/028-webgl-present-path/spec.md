# Spec: webgl 呈现路径收口 —— 按需渲染的画布在真机上不显示

- **ID**: 028-webgl-present-path
- **状态**: done
- **日期**: 2026-09-10
- **前置**: 021（webgl 模块）、023（three.js / glTF 查看器）、026（iOS 真机 webgl 呈现，
  本 spec 修正它的归因）、027（`defer-resize`，把问题从「偶发」变成「必现」）

## 1. 要解决什么

真机上打开两个 glTF 示例页，模型加载完成后画布不出图：

- **Android 真机**：有概率加载完不显示，**拖动一下才出来**；
- **iOS 真机**：完全不显示，拖动也不恢复。

同一份页面代码在 web 上正常。连续渲染的页面（`/example/webgl` 三角形、
俄罗斯方块）看不出问题，**只有按需渲染的页面**（spec 023 的两个 glTF 查看器，
模型加载完只画一帧）会中招。

设备排查（Redmi Note 9 Pro / Android 12，Realme RMX3700 / Android 16，
iPhone / iOS 26.6.1）定位到四条独立缺陷，它们叠在一起才形成上面的现象：

1. **`FjsWebglRuntime.pump()` 没有 await 纹理创建**。调用方
   （`_FjsWebglCanvasViewState`）把「textureId 有了 → setState 重建
   `Texture` widget」和 026 的补呈现都挂在 pump 的 future 上，而 pump 在纹理
   还不存在时就 resolve 了：setState 重建出的仍是空视图，补呈现拿到的
   `texture` 是 null。连续渲染的页面靠下一批 chunk 触发 rebuild 补上；按需
   渲染的页面没有下一批 chunk，`Texture` 永远建不出来。

2. **一个页面帧 swap 两次**。`FlutterAngle.updateTexture` 两端都是
   `eglSwapBuffers`（Android 是 SurfaceProducer 的 window surface，iOS 真机
   是 IOSurface 上的 pbuffer）。026 的补呈现让它一帧调两次，而 EGL 默认
   `EGL_BUFFER_DESTROYED` —— swap 之后后缓冲内容未定义，第二次 swap 推上去
   的是一块已经被丢弃的缓冲，把刚呈现好的那一帧盖掉。

3. **一个页面帧被切成两个缓冲**。JS 侧的 `getAttribLocation` 必须走 GL
   （spec 021 §3.4：它的返回值是驱动的属性槽下标，不能像 uniform location
   那样发句柄），查询会把当前命令流冲给宿主执行。于是 `draw()` 里
   clear + useProgram 落在查询这一侧、几何落在另一侧，中间夹了一次 present：
   清屏进了一个缓冲，几何画在下一个缓冲的未定义内容上（还带着上一帧的深度）。
   Android 上表现为**模型重复平铺**，iOS 上表现为全空。

4. **iOS 真机 swap 前没有真正同步**。`eglSwapBuffers` 不等 GPU，而在 ANGLE
   的 Apple 后端上 **`glFinish()` 也不等** —— 合成器读 IOSurface 时 Metal 的
   命令缓冲还在飞，读到的是上一帧。026 撞见过这个现象（注释原话
   "Found by accident — a debug glReadPixels after the swap made the canvas
   appear, because readback forces the sync"），但把功劳记给了 `finish()`。
   本轮在 swap 前读中心像素证伪：中心 `(174,109,103)`（Xbot 皮肤色）、
   角落 `(209,214,219)`（页面 clear 色）—— **GL 一直画对了，只是没人看见**。

另有一条独立的工具链缺陷，同一轮设备验证里暴露：

5. **`fjs run ios` 生成的 Info.plist 缺 `NSLocalNetworkUsageDescription`**。
   iOS 14+ 对没有这个键的 app **直接拒绝**局域网连接且不弹权限窗，dev server
   的每次请求报成 `SocketException: No route to host (errno = 65)`，看起来像
   IP 写错或防火墙，实际是权限被静默否掉（宪法 V）。dev 模式连 dev server 是
   工具链自身的传输命脉，不该让每个项目自己去 `app.config.ts` 里配。

## 2. 不做什么（Non-goals）

- **不修 flutter_angle**。上游 0.4.2 的 `updateTexture` 语义（swap + Apple
  的 `textureFrameAvailable`）、`activateTexture` 的 `eglMakeCurrent` 都照
  现状用，本 spec 只改我们这侧的调用时机与次数。
- **不改 `defer-resize` 的默认值**，也不回退 027。它只是让本来就存在的缺陷
  从偶发变必现，不是病因。
- **不给页面打补丁绕过**。把 `getAttribLocation` 挪到 link 之后确实能让手写
  glTF 页躲开第 3 条，但任何页面在 `draw()` 中途做 GL 查询都会踩到，修复必须
  在宿主侧。
- **不改 web 侧**。见第 4 节。
- 不动 spec 023 的 T023 / T025（iOS 模拟器上 three.js 的上游遗留问题）。

## 3. 用户可见的行为

页面代码**一行不改**。spec 023 的两个查看器保持「按需渲染」的写法 ——
只在模型加载完、手指拖动时各画一帧：

```vue
<template>
  <canvas defer-resize ref="cv" class="gl" @resize="onResize" @touchmove="onMove" />
</template>
```

```ts
// 渲染完全按需：rAF 空转，只有 requestDraw() 过的帧才画
let needsDraw = false;
function requestDraw(): void { needsDraw = true; }
function loop() {
  raf = requestAnimationFrame(loop);
  if (!needsDraw) return;
  needsDraw = false;
  draw();
}
```

改完之后：进页面 → 模型加载完 → **不碰屏幕，模型直接出现且只出现一个**；
Android 与 iOS 真机、iOS 模拟器、web 表现一致。

`fjs run ios` 首次装机时，系统会正常弹出「允许 App 访问本地网络」的询问，
允许后 dev server 正常连通；不再出现 `No route to host`。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | 画布内容在页面画完一帧后完整呈现；按需渲染与连续渲染表现一致 | 同左 |
| 事件载荷 | 不涉及（本 spec 不增删事件） | 不涉及 |
| 已知差异 | 无新增 | 无新增 |

**web 侧不需要改，也没有对应实现**：`getContext('webgl'/'webgl2')` 在 web
上直接交还浏览器自己的上下文（`fjs-runtime/src/web/components/canvas.ts`
第 15-16 行的注释已写明这条分流），呈现是浏览器的事，fjs 这侧根本没有
present 路径。本 spec 修的是 Flutter 宿主把 GL 帧交给合成器的那一段，
是**实现缺陷**而非能力差异，所以不进 `docs/css-compat.md` 的差异表。

`NSLocalNetworkUsageDescription` 是 iOS 平台权限，web 无对应概念。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

模块内部 API 有变（`FjsWebglRuntime.markFrameAvailable` → `layerReady`，
新增 `present`），但这两个只被同包的 `FjsWebglCanvasView` 调用，不跨 JSI/FFI
边界，也不是 `@ufjs/webgl` 对页面暴露的契约。

## 6. 验收标准

**静态**

1. `cd packages/fjs-webgl/flutter && flutter analyze` 无 issue
2. `cd packages/fjs-webgl/flutter && flutter test` 全过（当前 12 个）
3. `cd packages/fjs && npx tsc --noEmit` 通过；`pnpm --filter @ufjs/cli test` 通过
4. `pnpm --filter hello-fjs run typecheck` 通过

**Android 真机**（`fjs run android --device <id>`，进页面后**不触摸**再截图）

5. 「glTF 模型（手写）」：模型直接显示，**只有一个**，无重复平铺
6. 「three.js glTF」：模型直接显示
7. 「WebGL 三角形」：持续旋转，无回归
8. 5↔6 来回切 3 次，每次都正常

**iOS 真机**（`fjs run ios --device <id>`，同样不触摸）

9. 5-8 全部同样成立
10. 首次装机弹出本地网络权限询问；允许后日志出现
    `[dev] preloaded N page chunks`，无 `No route to host`
11. `grep NSLocalNetworkUsageDescription <项目>/.fjs/flutter/ios/Runner/Info.plist` 命中

**iOS 模拟器 / web 不回归**

12. `fjs run ios`（模拟器）三个 webgl 页表现同真机
13. `pnpm --filter hello-fjs run dev:web` 三个 webgl 页正常

**文档（宪法 VIII）**

14. `docs/toolchain.md` 记 `fjs run ios` 自动注入的 Info.plist 默认键
15. `docs/canvas-compat.md` 或 `docs/threading-model.md` 记「执行与呈现是两个
    时钟」这条约束，以及页面在 `draw()` 中途做 GL 查询为什么是安全的

## 7. 待澄清

- [ ] **iOS 真机每帧一次 1×1 `glReadPixels` 的代价要不要实测？** 这是第 4 条
      的修复手段：它靠「读回必须等队列排空」来强制同步，也就等于每帧一次流水线
      停顿。026 原本每帧一次 `glFinish()` 是同类开销（只是没生效），所以不算净
      增，但没量过。建议按 027 的方法（同一次会话、同样负载的 A/B）在 iOS 真机
      上量一次连续渲染页的帧间隔，超过阈值再找替代同步手段。要现在做吗？
- [ ] **026 的 T007 怎么落笔？** 已定：026 转 `done`，T007 记为「真机验证不通过，
      原因与修正见 028」。确认这个写法。
- [ ] **`NSLocalNetworkUsageDescription` 的默认文案**要不要可配 / 要不要中文？
      当前是英文一句："Connects to the fjs dev server on your local network to
      load and hot-reload the app bundle."（`app.config.ts` 的 `ios.infoPlist`
      仍可整键覆盖）。
