# Plan: webgl 画布间 GL 状态隔离

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是（修的就是两端差异） | Flutter：`packages/fjs-webgl/flutter/lib/src/gl_state.dart`（新）+ `lib/src/replay.dart`。Web：不改 —— 浏览器原生 context 天然隔离，修完 App 端向 web 对齐 |
| II 边界即契约 | 否 | 三张表都不动；webgl 命令流（`fjs-webgl/src/protocol.ts` ↔ `replay.dart` 的 `WebglCmd`）也不动，状态从已有指令记账 |
| III 同步单线程零序列化 | 是 | 记账与恢复都在 UI isolate 上、在已有的 `_drain` / `present` / `query` 同步路径里完成；不引入异步、不跨线程 |
| IV 外观照 WeUI | 否 | 无外观 |
| V 静默失效是 bug | 是 | 本 spec 修的就是一个静默黑屏。新增：恢复路径中 GL 抛异常照现有 `_drain` 的 catch 处理并 `[fjs] webgl` 告警；flutter_angle 未实现的 setter（`blendColor` `depthRange` `sampleCoverage` `stencil*Separate` `hint`）照旧 warn-once，不记账（GL 本就没收到）；`present` 仍「NOT UNDER TEST」，测试注释写明隔离逻辑的覆盖面止于纯 Dart 层 |
| VI 注释记录权衡 | 是 | `gl_state.dart` 顶部注释写：为什么共享 context（flutter_angle 前提）、为什么记账+diff 而非每画布独立 context / 全量重放、为什么用隐藏 VAO、哪些状态 plugin 会背着我们改；`_activate` 注释补「换 surface 之后恢复状态」 |
| VII JS 能包就不要下 Dart | 是 | 必须落 Dart：问题出在宿主把多张画布的命令流喂进同一个 GL context，JS 侧每张画布的 context 对象本来就是独立的，看不见另一张画布也看不见 plugin 背着改的 viewport/framebuffer。在 JS 侧给每条命令前插复位指令只能做「先后」场景且每帧付代价，做不了按真实 GL 当前值 diff |
| VIII 变更落到文档 | 是 | `docs/canvas-compat.md` webgl 行（§1 表 `getContext('webgl')` 行）补隔离说明；`docs/roadmap.md` webgl 段新增 ✅ spec 036 条目 |

无破例。

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | — | 不涉及 |
| JS runtime / `@ufjs/webgl` JS | — | 不涉及（`packages/fjs-webgl/src/*` 不改） |
| Web 适配层 | — | 不涉及 |
| C++ 引擎 | — | 不涉及 |
| Dart 宿主（webgl 模块） | `packages/fjs-webgl/flutter/lib/src/gl_state.dart`（**新**） | `WebglContextState`（单画布记账）、`GlCurrentState`（真实 GL 当前值影子，全局一份）、`TrackedGlBindings extends FjsGlBindings`（装饰器：记账 + 转发 + 隐藏 VAO 映射 + `syncTo`） |
| Dart 宿主（webgl 模块） | `packages/fjs-webgl/flutter/lib/src/replay.dart` | `_NodeGlState` 加 `tracked`；`_createTexture` 用 `TrackedGlBindings` 包 `FjsAngleBindings` 喂给 decoder；`_activate` 换 surface 后 `invalidatePlugin()` + 同步状态；`present` 的 `updateTexture`、`_freeTexture`、`createTexture` 之后 `invalidatePlugin()`；`query` 读 GL 前同步状态；`disposeNode` 删隐藏 VAO 并清 owner |
| Dart 宿主（webgl 模块） | `packages/fjs-webgl/flutter/lib/fjs_webgl.dart` | 已 `export 'src/replay.dart'`；按需加 `export 'src/gl_state.dart'`（测试要 import 到） |
| 测试 | `packages/fjs-webgl/flutter/test/webgl_replay_test.dart` | `FakeBindings` 补记录 state setter；新增 `group('context state isolation (spec 036)')` |
| 示例页 | — | 不改（spec 非目标） |
| 文档 | `docs/canvas-compat.md`、`docs/roadmap.md` | 见 VIII |

## 3. 方案

### 3.1 三个对象

```
FjsWebglRuntime ── GlCurrentState _gl   (一份：真实 GL context 此刻的值，可带「未知」)
   └─ _NodeGlState
        ├─ FjsAngleBindings  angle       (不改：id→GL 对象、调 plugin)
        ├─ TrackedGlBindings tracked     (decoder 实际喂的 bindings)
        │     ├─ WebglContextState own   (本画布设过的值；没设过 = WebGL 默认)
        │     └─ inner = angle
        └─ WebglChunkDecoder(tracked)
```

- **记账**：`TrackedGlBindings` 覆写每个会落到 GL 的 context 级 setter —— 先写
  `own`，再写 `_gl`（值 + `owner = own`），再转发 `inner`。其它方法（资源、上传、uniform、draw、查询）纯转发。
  **同画布内不过滤重复调用**：页面发几次就转发几次，保持现行为，spec 验收 1 的「不切换无额外调用」也就天然成立。
- **键**（覆盖 spec §1 表，只收 GL 真收到的）：
  - 开关：`BLEND CULL_FACE DEPTH_TEST DITHER POLYGON_OFFSET_FILL SAMPLE_ALPHA_TO_COVERAGE SAMPLE_COVERAGE SCISSOR_TEST STENCIL_TEST RASTERIZER_DISCARD`
  - 标量：`blendEquationSeparate`（`blendEquation` 归一成 rgb=alpha）、`blendFuncSeparate`（同理）、`clearColor` `clearDepth` `clearStencil` `colorMask` `cullFace` `depthFunc` `depthMask` `frontFace` `lineWidth` `polygonOffset` `scissor` `stencilFunc` `stencilMask` `stencilOp` `viewport`、`pixelStorei`（按 pname，只收 `FjsAngleBindings` 不吞掉的）
  - 绑定：`program`、`vertexArray`、`ARRAY_BUFFER` / `COPY_READ_BUFFER` / `COPY_WRITE_BUFFER` / `PIXEL_PACK_BUFFER` / `PIXEL_UNPACK_BUFFER` / `UNIFORM_BUFFER`（`ELEMENT_ARRAY_BUFFER` 属于 VAO，不记）、`FRAMEBUFFER`（`DRAW/READ` 分记）、`RENDERBUFFER`、`activeTexture`、`(unit, target)` 纹理绑定（只记碰过的 unit）
  - 通用顶点属性值：`vertexAttrib1f…4fv` 按 index 归一成 vec4
  - 绑定类的值存 **(owner, jsId)**：两张画布的 JS id 都从 1 起，同一个数字是两个 GL 对象，比较必须带 owner。
- **同步**（`tracked.syncTo(_gl)`）：
  1. `_gl.owner == own` 且 `_gl` 无未知键 → 直接返回（单画布每帧 O(1)，验收 7）。
  2. 否则对「`own` 设过的键 ∪ `_gl` 里非默认或未知的键」逐个取目标值（`own` 有就用，没有就是 WebGL 默认），
     与 `_gl` 当前值不同（或未知）才调 `inner` 对应 setter，并回写 `_gl`。
  3. 纹理单元：先逐个 `activeTexture(unit)` + `bindTexture`，最后 `activeTexture(own.activeUnit)`。
     `bindBuffer(ARRAY_BUFFER)` 放在 `vertexArray` 之后（VAO 切换不影响它，但顺序固定便于测试断言）。
  4. `_gl.owner = own`。
- **删除语义**：`deleteBuffer/Texture/Framebuffer/Renderbuffer/VertexArray(id)` 时，GL 会把正绑着的该对象解绑，
  `own` 与（owner 为本画布时的）`_gl` 里引用它的绑定同步归 0。删正绑着的 VAO 后回绑隐藏 VAO（见 3.2）。
  `deleteProgram` 按 GL 语义不立刻解绑，不动账。

### 3.2 隐藏 VAO（spec 待澄清 2 已定）

- 每个 `TrackedGlBindings` 构造时 `inner.createVertexArray(kHiddenVaoId)` 并立即 `inner.bindVertexArray(kHiddenVaoId)`，
  `kHiddenVaoId = 0xFFFFFFFF`（JS 侧 id 从 1 递增分配、每画布一张 id 表，不会撞）。
- 页面 `bindVertexArray(0)` → 转发成 `bindVertexArray(kHiddenVaoId)`；`own.vertexArray` 记 0，默认值也是 0，
  于是「没绑过 VAO 的画布」的同步目标就是自己的隐藏 VAO。
- 效果：默认 VAO 上的 `enable/disableVertexAttribArray` `vertexAttribPointer` `vertexAttribDivisor`
  `ELEMENT_ARRAY_BUFFER` 天然按画布隔离，**不记账**。
- `disposeNode` 时 `inner.deleteVertexArray(kHiddenVaoId)`（VAO 是 context 级对象，哪个 surface 当前都能删）。

### 3.3 plugin 背着改的状态 → 标「未知」

flutter_angle 0.4.2 读源码核实（`lib/desktop/angle.dart`）：

| plugin 调用 | 改到的 GL 状态 |
|---|---|
| `createTexture` | `activeTexture(TEXTURE0)`、`bindTexture(TEXTURE_2D)`、`bindFramebuffer`、`bindRenderbuffer(0)`、`viewport` |
| `texture.activate()`（`activateTexture`） | `viewport(0,0,w*dpr,h*dpr)`、`bindFramebuffer(texture.fboId)` |
| `updateTexture` | 非 surface 路径 `bindFramebuffer(0)` |
| `deleteTexture`（非 Android） | `bindFramebuffer`、`clearColor(0,0,0,0)` |

`GlCurrentState.invalidatePlugin()` 把 `viewport` `FRAMEBUFFER` `RENDERBUFFER` `activeTexture` 全部 `TEXTURE_2D` 绑定 `clearColor`
标为未知，并清 owner。调用点：`_createTexture` 里 `createTexture` 之后、`_activate` 里 `texture.activate()` 之后、
`present` 里 `updateTexture` 之后、`_freeTexture` 里 `deleteTexture` 之后。

**默认值例外**：`viewport` 的 WebGL 默认是「整张绘图缓冲」、`FRAMEBUFFER` 的默认是「本画布的默认帧缓冲」，
这两个正是 `activate()` 设的值。所以 `_activate` 在 `activate()` 之后调 `_gl.markPluginDefaults(own)`：
把这两个键记成「= own 的默认」而非未知 —— 页面没自己设过就不重发，设过才重发。
代价：页面自设了 viewport / framebuffer 的画布，每个 Flutter 帧 re-activate 后多 1–2 个调用（现在是被 plugin 静默盖掉，属于顺手修正）。

### 3.4 接入 `replay.dart`

```dart
void _activate(int nodeId, _NodeGlState state) {
  if (_activeNode == nodeId && state.boundSincePresent) {
    state.tracked?.syncTo(_gl);   // 通常 O(1)：owner 相同、无未知键
    return;
  }
  state.texture?.activate();
  _gl.invalidatePlugin();
  if (state.tracked != null) _gl.markPluginDefaults(state.tracked!.own);
  state.tracked?.syncTo(_gl);
  ...
}
```

- `query` 在 `_drainIfPending` 之后、读 GL 之前调 `state.tracked?.syncTo(_gl)`（**只同步状态、不换 surface**：
  「一帧内不重绑 surface」是 spec 028 的硬约束，状态查询只需要 context 状态对）。
- `_createTexture`：`FjsAngleBindings` 照旧建，外面包 `TrackedGlBindings`，`state.decoder = WebglChunkDecoder(tracked)`；
  `present` 里 `finish` / `readPixelsRgba` 仍走 `state.bindings`（非记账方法，无所谓）。
- `disposeNode`：若 `_gl.owner == state.tracked?.own` 则清 owner；删隐藏 VAO。

### 3.4a 实现时的两处修正（/implement 阶段，2026-09-11）

1. **flutter_angle 未实现的 setter 也记账**（原 3.1 / 宪法 V 行写的是「不记账」）。
   按 GL 语义记账与 plugin 实现与否脱钩：plugin 以后补上这些方法，状态不会重新开始串；
   恢复时经 `inner` 调到它们只会命中现有 warn-once。stencil / blend 恢复时，前后面（rgb/alpha）相同就走非 Separate 形式，
   所以不会因为 `stencil*Separate` 未实现而恢复不了。
2. **plugin 改动的建模**（细化 3.3 的 `markPluginDefaults`）：
   - `pluginTouched()`：`createTexture` / `updateTexture` / `deleteTexture` 之后，把 3.3 表里的键标「未知」并放进 dirty 集；
   - `pluginActivated(w, h)`：`activate()` 之后，把 `viewport` 记成已知值 `(0,0,w,h)`、`DRAW/READ_FRAMEBUFFER` 记成默认帧缓冲（已知），并放进 dirty 集；
   - `syncTo`：owner 相同 → 只对 dirty 集逐键 diff；owner 不同 → 全量 diff。结束清空 dirty 集。
   - `viewport` / `scissor` 的 WebGL 默认值是 `(0,0,绘图缓冲宽,高)`，`TrackedGlBindings` 构造时由 `_createTexture` 传入像素尺寸
     （resize 会重建 bindings，与现有「resize 重建 FjsAngleBindings」一致）。

### 3.5 被否掉的备选

| 备选 | 否掉原因 |
|---|---|
| 只在新画布建 context 时复位到默认值 | 只修「先后」；push 页、转场、tab 保活时两张画布交替执行照样串。spec 待澄清 1 已定 |
| 每张画布一个独立 EGL context（共享 display） | 要改 flutter_angle 原生层（Android JNI 只有一个 `g_context`、Apple 走 `_baseAppContext`），且 surface 与 context 的配对由 plugin 管，改动面与升级成本都不合算 |
| 切换时全量重放本画布状态 | 键多（纹理单元 × target），多画布并存时每次切换几十个调用；diff 在单画布时是 O(1) 早退，并存时只发真正不同的项。spec 待澄清 3 已定 |
| 默认 VAO 上的属性逐条记账（pointer + buffer + offset + divisor + enable） | 条目多、要跟 `ELEMENT_ARRAY_BUFFER`、易漏；隐藏 VAO 用 GL 自己的机制隔离，零记账。spec 待澄清 2 已定 |
| 用 `glGet*` 读真实 GL 当前值代替影子 | 每次切换几十次同步 `glGet`，在 ANGLE 上可能触发管线等待；且 flutter_angle 的 `getParameter` 对很多键抛异常（见 `FjsAngleBindings.getParameter`） |
| 在 `FjsAngleBindings` 的每个 setter 里直接记账 | 与 plugin 耦合，`flutter test` 没有 `RenderingContext` 测不到；装饰器可以用 `FakeBindings` 当 inner 全覆盖 |
| JS 侧在每帧开头插复位命令 | 看不见其他画布与 plugin 改动，只能全量复位，每帧付代价；且违背「状态语义在宿主」 |

## 4. 风险

1. **漏记某个 setter**：漏一个键 = 该键继续串，且静默。缓解：测试里对 `FjsGlBindings` 的 state 段逐个方法断言
   「A 设非默认 → B 同步后恢复默认」（表驱动，方法清单写死在测试里，新增 setter 不补测试会显眼）。
2. **plugin 背着改了 3.3 表以外的状态**：只核对了 0.4.2。缓解：`gl_state.dart` 注释写明版本与出处；升级 flutter_angle 时复核。
3. **隐藏 VAO 与 `getParameter(VERTEX_ARRAY_BINDING)`**：会读到隐藏 VAO 而非 null。现有 `query` 本就不把 GL 对象映射回 JS 对象（返回 plugin 对象），three.js 不读这个键；登记为已知差异，不处理。
4. **iOS 模拟器 FBO 路径的 `bindFramebuffer(null)`**：`FjsAngleBindings` 把 null 映射成 GL 0，而模拟器画布的默认帧缓冲是 `fboId`。**现存问题，本 spec 不修**；3.3 的 `markPluginDefaults` 不会让它更糟（没自设 framebuffer 的画布不重发）。
5. **`readback()`（toDataURL）不调 `_activate`**：读的是当前 surface。现存问题，不在本 spec 范围，登记。
6. **`present` 仍然 NOT UNDER TEST**：`_activate` / `present` 的接线只能真机验。按 spec 验收 3–5 的顺序跑 Android 真机 + iOS 模拟器，并复跑 spec 028 T033–T035 的按需渲染页（glTF 两个查看器）确认呈现路径没被扰动。
7. **并存验收的可操作性**：hello-fjs 里 webgl 页之间没有直接 push 入口。验收 5 用「三角形页返回的离场转场期间立刻点实例化」+ 临时调试页（两张 webgl canvas 同页，**不提交**）完成，结果记进 tasks.md。

## 5. 验证路径

```bash
# 纯 Dart 层
cd packages/fjs-webgl/flutter && flutter test

# JS 侧未动
pnpm --filter @ufjs/webgl test
pnpm --filter @ufjs/webgl typecheck
pnpm --filter hello-fjs run typecheck

# Android 真机（M2007J17C）debug
cd examples/hello-fjs
fjs run android --device 94629393
#   三角形 → 返回 → 实例化；three.js glTF → 返回 → 实例化；转场中途切换；两 canvas 调试页
#   回归：三角形 / 实例化 / three.js glTF / glTF 手写 / 3D 飞机大战 单独打开
#   adb logcat | grep '\[fjs\] webgl'

# Android 真机 release
fjs run android --release --device 94629393

# 帧耗时对比（修改前后各一次，3D 飞机大战）
fjs run android --profile --device 94629393

# iOS 模拟器
fjs run ios
```
