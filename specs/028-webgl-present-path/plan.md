# Plan: webgl 呈现路径收口

对应 spec：`./spec.md`

> **spec 待澄清的处理**：用户在三条未答的情况下让继续。按以下默认值推进，
> 都是可逆的，任何一条要改就改，不阻塞落地：
> 1. iOS 每帧 1×1 `readPixels` 的代价 —— **本轮不实测**，作为 tasks 里一条
>    独立的后续项列出（027 的 A/B 方法）。理由：它替换的是 026 每帧一次
>    `glFinish()`，同类开销、不是净增，且不做它就没有正确的帧。
> 2. 026 的 T007 —— 转 `done`，T007 记「真机验证不通过，原因与修正见 028」。
> 3. 权限文案 —— 保持英文一句，`app.config.ts` 的 `ios.infoPlist` 可整键覆盖。

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | **不涉及（有理由）** | web 侧没有这条路径：`getContext('webgl')` 在 web 上直接交还浏览器原生 context（`packages/fjs-runtime/src/web/components/canvas.ts:15-16` 的注释写明了这条分流），呈现由浏览器负责，fjs 这侧无 present 代码可改。修的是 Flutter 宿主把 GL 帧交给合成器的那一段 —— **实现缺陷，不是能力差异**，所以不进 `docs/css-compat.md` 差异表。页面源码一行不改，两端行为改完后一致（spec §6 的 13 条验收就是 web 侧的不回归） |
| II 边界即契约 | **不涉及** | 三张表都不动。改的是 `@ufjs/webgl` 模块内部：`FjsWebglRuntime.markFrameAvailable` → `layerReady`、新增 `present`，调用方只有同包的 `FjsWebglCanvasView`。op 11 的字节格式、`fjs.webgl.*` 查询名、页面看到的 `WebGLRenderingContext` 形状全部不变 |
| III 同步单线程零序列化 | **不涉及** | 不新增 JSON 桥、不跨线程。`present` 挂在 `addPostFrameCallback` 上，仍在 UI isolate；JS 侧的同步查询语义（`getAttribLocation` 走 GL）保持原样 —— 本 spec 恰恰是让宿主**容忍**这个同步语义带来的「一帧两批」 |
| IV 外观照 WeUI | 不涉及 | 不动内置组件外观 |
| V 静默失效是 bug | **正面涉及** | 缺陷 5（Info.plist）就是这条的反例：iOS 拒绝局域网且不弹窗，报成 `No route to host`，看起来像 IP 写错。修复把它变成一次正常的系统权限询问。另外 `_syncAppleSurface` 的作用域判断（`fboId == 0` 且 `surfaceId` 有效）沿用 026 的 `_appleDeviceSurfaceMissing` 口径，surface 建不出来时仍走 026 那条显式 `debugPrint` 失败路径，不静默 |
| VI 注释记录权衡 | **正面涉及** | 四条缺陷每条都要在代码里留下「为什么这样而不是那样」，且必须写明**证据**：EGL `EGL_BUFFER_DESTROYED` 为什么让第二次 swap 有害、swap 前读到的像素值（中心 `(174,109,103)` / 角落 `(209,214,219)`）为什么证伪了 `glFinish`。026 的注释之所以把人带偏，就是因为它记的是猜测不是实测 |
| VII JS 能包就不要下 Dart | **必须落 Dart（有理由）** | 这个能力要的信息 JS 侧根本够不着：纹理是否创建完、`Texture` widget 有没有进 widget 树、Flutter 帧边界在哪、EGL surface 当前绑的是谁 —— 全是 Flutter 宿主的私有状态，op 协议里没有、也不该有。JS 侧唯一能做的是「让页面别在 `draw()` 中途查 GL」，那是给每个页面打补丁而不是修 bug（spec §2 已列为 Non-goal） |
| VIII 变更落到文档 | **涉及** | 见第 2 节文档行。`docs/canvas-compat.md:73` 现在写着 026 的错误归因（"present 前显式 `glFinish`"），**必须改**，否则下一个人还会被带偏 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | `packages/fjs/src/commands/run.ts` | `syncHostConfig` 的 plist 段：`values` 从 `config.ios?.infoPlist ?? {}` 改为「默认键 + 用户配置展开覆盖」，默认键为 `NSLocalNetworkUsageDescription` |
| CLI 测试 | `packages/fjs/test/run.test.ts` | 已有 plist managed-block 测试（L101-138）。加两条断言：无 `ios.infoPlist` 配置时默认键也写进去；用户同名配置能覆盖默认值 |
| JS runtime | — | 不动 |
| Web 适配层 | — | 不动（宪法 I 行已说明理由） |
| C++ 引擎 | — | 不动 |
| Dart 宿主 | `packages/fjs-webgl/flutter/lib/src/replay.dart` | 主体。`_NodeGlState` 加 `needsPresent` / `layerLive` / `boundSincePresent` / `creation`；`pump()` 改为 await 创建并复用在途 future；`_drain()` 只执行不呈现；新增 `_schedulePresent` / `present` / `layerReady` / `_activate` / `_syncAppleSurface`；`markFrameAvailable` 删除；`_freeTexture` 两侧清 `_activeNode` |
| Dart 宿主 | `packages/fjs-webgl/flutter/lib/fjs_webgl.dart` | `_FjsWebglCanvasViewState`：pump 的 `whenComplete` 只留 setState；新增 `_scheduleLayerReady()`，在 `build` 里 `id != null` 时挂一次 post-frame，回调 `FjsWebglRuntime.layerReady` |
| Dart 测试 | `packages/fjs-webgl/flutter/test/webgl_replay_test.dart` | 加可测的那部分（见第 4 节「可测边界」） |
| 示例 | `examples/hello-fjs/src/pages/example/gltf-viewer.vue` | 顺带修 `autoSpin`：ref 当裸值判断（恒真）、`yaw += 0.01` 写了两遍、按需渲染下不给自己排下一帧 |
| 文档 | `docs/canvas-compat.md` | L73 iOS 真机那段**改写**：删掉「present 前显式 `glFinish`」这条错误归因，换成「swap 前一次 1×1 读回强制同步」，并补上「一帧只 present 一次」「执行与呈现是两个时钟」 |
| 文档 | `docs/threading-model.md` | 新增一节：GL 命令的**执行**与**呈现**分属两个时钟 —— 执行随 chunk 到达（含 JS 同步查询触发的中途 drain），呈现每 Flutter 帧一次且在 `Texture` layer 就绪后 |
| 文档 | `docs/toolchain.md` | `infoPlist` 那节（L271-290）补：`fjs run ios` 会自动注入哪些默认键、为什么、怎么覆盖 |
| 文档 | `docs/roadmap.md` | 026 条目补一句被 028 修正 |
| 前置 spec | `specs/026-ios-device-webgl-and-release-fetch/{spec.md,tasks.md}` | 状态转 `done`；T007 记「真机验证不通过，原因与修正见 028」 |

## 3. 方案

### 3.1 一条主线：执行与呈现是两个时钟

所有四条缺陷收敛到同一句话 —— **GL 命令什么时候执行，和这一帧什么时候交给
合成器，是两件事**。026 之前的代码把它们焊在 `_drain` 里，于是：

- chunk 什么时候到，就什么时候 swap（→ 缺陷 3：JS 查询在 `draw()` 中途冲一次
  命令流，就在中途 swap 一次）；
- 想「补一次呈现」就只能再调一次 `updateTexture`（→ 缺陷 2：那是第二次 swap）。

拆开之后：

| | 时机 | 谁触发 |
|---|---|---|
| 执行 | chunk 到达就执行，随时 | `pump`（每帧）、`_drainIfPending`（JS 同步查询） |
| 呈现 | 每 Flutter 帧至多一次，且 `Texture` layer 已就绪 | `present`，由 post-frame 回调驱动 |

`present()` 在 swap 前先 `_drainIfPending` 一次，把「这一帧稍后才到的后半批」
也拉进同一个后缓冲 —— 这是缺陷 3 的正解：不禁止页面中途查 GL，而是保证中途
执行**不会**伴随中途呈现。

### 3.2 缺陷 1：`pump()` await 创建

调用方把「建 `Texture` widget」挂在 pump 的 future 上，那 pump 就必须在纹理
存在之后才 resolve。并发的 pump 共享同一个 `state.creation` future 一起 await，
而不是早退再靠下一帧自旋。

### 3.3 缺陷 4：iOS 真机的显式同步

`_syncAppleSurface(bindings, texture)`：Apple 平台 + 设备 surface 路径
（`fboId == 0` 且 `surfaceId` 有效）时，swap 前做一次 1×1 `readPixelsRgba`。
靠「读回必须等命令队列排空」拿到同步。作用域按 026 的 `_appleDeviceSurfaceMissing`
口径切：iOS 模拟器走 FBO 路径、Android 的 SurfaceProducer 自己同步，都不付这个
流水线停顿。

### 3.4 `_activate` 的作用域：一帧内有效，不跨 present

`texture.activate()` 是 `eglMakeCurrent`，重绑会丢弃后缓冲。所以同一帧内的
第二次 drain 不再重绑（否则缺陷 3 换个形式复发）；但绑定**不跨 present** ——
iOS 真机上 `updateTexture` 末尾那次 `textureFrameAvailable` platform call 之后
当前 surface 就不再可信，跨帧沿用会让后续每一帧渲染到不存在的地方。
`_freeTexture` 在 `await` 两侧都清 `_activeNode`：插件的 `deleteTexture` 会先
`eglMakeCurrent(旧 surface)` 再 `eglDestroySurface`，而调用方不 await，这次
makeCurrent 可能落在下一个节点绑定之后。

### 3.5 被否掉的备选

| 备选 | 否掉的原因 |
|------|-----------|
| **在示例页里把 `getAttribLocation` 挪到 link 之后** | 设备上验证有效（Android 平铺立刻消失），但那是给一个页面打补丁：任何页面在 `draw()` 中途做 GL 查询都会踩同一个坑，而同步查询是 spec 021 §3.4 定下的契约。修复必须在宿主侧（spec §2 Non-goal） |
| **创建纹理后先 swap 几次「预热」** | 设备上试过 1 次和 3 次，都没用 —— 说明不是缓冲轮转次数的问题。而且 swap 一块未定义的缓冲本身就是缺陷 2 那个错误的翻版 |
| **把第一次 present 延后 N 个 Flutter 帧** | 试过 N=2，无效。同样证伪了「消费端要几帧才追上」这条猜测 |
| **保留 026 的补呈现，只是不再 swap** | flutter_angle 0.4.2 没有「只 mark 不 swap」的公开 API：`updateTexture` 是唯一入口，Android 上它甚至不调 `textureFrameAvailable`。要么改上游（Non-goal），要么就一帧只调一次 |
| **`glFlush` / `eglWaitClient` 代替读回** | `glFlush` 不等待（`glFinish` 都不等，`glFlush` 更不会）；`eglWaitClient` 没有从 flutter_angle 暴露出来 |
| **让页面自己在 `app.config.ts` 配 `NSLocalNetworkUsageDescription`** | dev server 是工具链自身的传输命脉，不是项目的业务选择。每个新项目都要踩一次「No route to host 查半天」不合理 |

## 4. 风险

**可测边界（诚实说明）**。`pump` / `present` 需要真的 `FlutterAngle`，
widget 测试里没有 —— **一帧一次 present、drain-before-present、Apple 同步这三条
不变量是设备验证的，不是单测覆盖的**。单测能覆盖的只有不需要纹理的那部分
（`query` 的 pre-context 分支、`layerReady` 在无纹理节点上不抛也不呈现）。
这一点要在 tasks 里显式写成一条，不要让 `flutter test` 全绿被读成「呈现路径有
回归保护」（宪法 V：测试跳过要显式说明）。

**平台矩阵是这个 spec 的主要风险面**。四条缺陷在四种路径上表现完全不同：

| 路径 | 缺陷 2 | 缺陷 3 | 缺陷 4 |
|---|---|---|---|
| Android SurfaceProducer | 帧丢失 | 重复平铺 | 不适用 |
| iOS 真机 IOSurface/pbuffer | 帧丢失 | 全空 | 全空 |
| iOS 模拟器 FBO | ? 未验证 | ? 未验证 | 不适用 |
| web | 不适用 | 不适用 | 不适用 |

**iOS 模拟器这一列本轮完全没测**，而它走的是与真机机制完全不同的 FBO 路径
（026 spec §1 已强调这点）。验收 12 必须真跑。

**Android 只在一台机器上验证过**（Redmi Note 9 Pro / API 31，`ImageTextureEntry
can't wait on the fence on Android < 33` 那条路径）。手边的 RMX3700 / API 36 走
的是有 fence 的路径，**没测到**（设备中途拔了）。验收 5-8 建议两台都跑。

**性能未量**。iOS 真机每帧一次读回是流水线停顿，见开头待澄清 1。

**`_activate` 的作用域是这轮最微妙的一处**：一帧内不重绑、跨 present 必重绑。
两个方向都有实测反例（不重绑 → iOS 全空；帧内重绑 → Android 平铺），注释必须
把两个反例都写下来，否则以后任何一次「简化」都会打回其中一边。

## 5. 验证路径

```bash
# 静态
cd packages/fjs-webgl/flutter && flutter analyze && flutter test
cd packages/fjs && npx tsc --noEmit && npx vitest run
cd examples/hello-fjs && npx vue-tsc --noEmit

# Android 真机（两台，进页面后不触摸再截图）
cd examples/hello-fjs && npx fjs run android --device <redmi-id>
cd examples/hello-fjs && npx fjs run android --device <rmx3700-id>
adb -s <id> exec-out screencap -p > /tmp/gltf.png

# iOS 真机 + 模拟器
cd examples/hello-fjs && npx fjs run ios --device <iphone-udid>
grep NSLocalNetworkUsageDescription .fjs/flutter/ios/Runner/Info.plist
cd examples/hello-fjs && npx fjs run ios          # 模拟器

# web 不回归
pnpm --filter hello-fjs run dev:web
```

三个页面每次都要看：**glTF 模型（手写）**、**three.js glTF**、**WebGL 三角形**；
前两个「加载完不碰屏幕」，第三个看持续旋转。
