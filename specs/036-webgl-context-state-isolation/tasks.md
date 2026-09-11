# Tasks: webgl 画布间 GL 状态隔离

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 核对三张契约表与 webgl 命令流均不需要改：`packages/fjs-runtime/src/ui/ops.ts` ↔ `packages/flutter_fjs/lib/src/ui_ops.dart`、`native-global.d.ts` ↔ `natives.cpp`、`element.ts` ↔ `fjs.h`、`packages/fjs-webgl/src/protocol.ts` ↔ `packages/fjs-webgl/flutter/lib/src/replay.dart` 的 `WebglCmd` —— **不涉及**：状态全部由已有 setter 指令记账，改动只在宿主执行层

## 实现

- [x] T010 新建 `packages/fjs-webgl/flutter/lib/src/gl_state.dart`：顶部权衡注释（共享 context 的出处与 flutter_angle 版本、记账 + diff、隐藏 VAO、plugin 背着改的状态表）；定义状态键与 WebGL 默认值表（开关 / 标量 / 绑定 / 纹理单元 / 通用顶点属性值，plan 3.1）
- [x] T011 `gl_state.dart`：实现 `WebglContextState`（单画布记账，绑定值存 `(owner, jsId)`）与 `GlCurrentState`（值 + 未知标记 + `owner`，`pluginTouched()`、`pluginActivated(w, h)`、`dirty` 集，plan 3.3 / 3.4a-2）
- [x] T012 `gl_state.dart`：实现 `TrackedGlBindings extends FjsGlBindings` —— 所有 context 级 setter 记账到 `own` 与 `_gl` 后转发；`blendEquation` / `blendFunc` 归一到 Separate 形式；`pixelStorei` 只记 GL 真收到的 pname；flutter_angle 未实现的 setter **也记账**（plan 3.4a-1）；其余方法纯转发
- [x] T013 `gl_state.dart`：`TrackedGlBindings` 构造时建并绑定隐藏 VAO（`kHiddenVaoId = 0xFFFFFFFF`），`bindVertexArray(0)` 映射到它，删正绑着的 VAO 后回绑隐藏 VAO；提供 `dispose()` 删隐藏 VAO（plan 3.2）
- [x] T014 `gl_state.dart`：删除语义 —— `deleteBuffer/Texture/Framebuffer/Renderbuffer/VertexArray` 把 `own` 与 owner 为本画布的 `_gl` 中引用该对象的绑定归 0；`deleteProgram` 不动账
- [x] T015 `gl_state.dart`：实现 `sync()` —— owner 相同只查 `dirty` 集（空则早退）；否则按「own 设过 ∪ `_gl` 记过的键」逐键 diff 调 `inner`，纹理单元先逐单元绑再恢复 `activeTexture`，最后置 owner（plan 3.1 同步 1–4）
- [x] T016 `packages/fjs-webgl/flutter/lib/fjs_webgl.dart`：`export 'src/gl_state.dart'`（测试与模块消费者可见）
- [x] T017 `replay.dart`：`FjsWebglRuntime` 加 `GlCurrentState _gl`；`_NodeGlState` 加 `tracked`；`_createTexture` 在 `angle.createTexture` 后 `_gl.pluginTouched()`、`activate()` 后 `pluginActivated`，resize 时先 `dispose` 旧 tracker，用 `TrackedGlBindings` 包 `FjsAngleBindings`，decoder 喂 `tracked`
- [x] T018 `replay.dart`：`_activate` —— 早退分支也 `tracked.sync()`；换 surface 分支在 `texture.activate()` 后 `pluginActivated(w, h)` + `sync()`；方法注释补「换 surface 后恢复本画布状态」及原因（plan 3.4）
- [x] T019 `replay.dart`：`present` 的 `updateTexture` 之后、`_freeTexture` 发起 `deleteTexture` 后（await 之前）调 `_gl.pluginTouched()`；`query` 在 `_drainIfPending` 之后读 GL 之前 `tracked.sync()`（只同步状态不换 surface，注释写明 spec 028 约束）
- [x] T020 `replay.dart`：`disposeNode` —— owner 是该画布时清 `_gl.owner`，调 `tracked.dispose()` 删隐藏 VAO

## 两端对齐

- [x] T021 Web 侧确认无需实现：`packages/fjs-webgl/index.ts` / web 路径透传浏览器原生 context，天然每画布独立；在 plan 宪法 I 行已登记，此处复核 web 预览「三角形 → 返回 → 实例化」正常作为对照基线（`pnpm --filter hello-fjs run dev:web`）—— web 预览实测：三角形 → 返回 → 实例化，方块网格与三角形正常
- [x] T022 两端对拍：Android 真机与 web 在「三角形 → 返回 → 实例化」「three.js glTF → 返回 → 实例化」两个顺序下画面一致 —— 实测两端两个顺序均出图（真机 debug）

## 测试

- [x] T030 新测试文件 `packages/fjs-webgl/flutter/test/gl_state_test.dart`：`StateRecorder extends FakeBindings`（子类而非改 `FakeBindings`，不动解码测试的调用列表）补记录所有 context 级 setter、`bindVertexArray`、`createVertexArray`/`deleteVertexArray`、`activeTexture`、`bindTexture`、`bindFramebuffer`、`bindRenderbuffer`、`useProgram`、`vertexAttrib*`
- [x] T031 `gl_state_test.dart` 新增 `group('context state isolation (spec 036)')`，表驱动：对状态键清单逐项「画布 A 设非默认 → 新画布 B `sync()` → inner 收到恢复默认的调用」；清单写死，新增 setter 不补就显眼（plan 风险 1）
- [x] T032 测试：A、B 交替执行（各自设不同值）→ 每次切换后 `GlCurrentState` 等于该画布自己的值，且只发差异项
- [x] T033 测试：同一画布连续 `sync()` 不发任何调用；`pluginTouched()` 后只重发 plugin 碰过的键（页面自己的其它状态不重发），`pluginActivated()` 后未自设的 viewport / framebuffer 不重发
- [x] T034 测试：隐藏 VAO —— 构造即 create+bind `0xFFFFFFFF`；`bindVertexArray(0)` 转发为隐藏 id；删正绑着的 VAO 后回绑隐藏；`dispose` 删除它
- [x] T035 测试：删除语义 —— 删正绑着的 buffer/texture 后账归 0，切走再切回不会重新绑定已删对象；两画布同 jsId 不被当作同一对象
- [x] T036 在 `webgl_replay_test.dart` 的 spec 028 覆盖说明注释旁补一句：`_activate` / `present` 的接线仍 NOT UNDER TEST，隔离逻辑的测试覆盖止于 `gl_state.dart`

## 文档

- [x] T040 `docs/canvas-compat.md` §1 `getContext('webgl')` 行：补「每张画布 context 状态独立 —— flutter_angle 各平台共用一个 GL context，宿主按画布记账、切换时 diff 恢复（spec 036）」
- [x] T041 `docs/roadmap.md` webgl 段新增 ✅ **webgl 画布间 GL 状态隔离**（spec 036）条目
- [x] T042 `specs/036-webgl-context-state-isolation/spec.md` 状态改为 `done`；本文件记录各项实测结果

## 验收

- [x] T050 `cd packages/fjs-webgl/flutter && flutter test` 通过（确认不是 `No tests ran`）—— spec 验收 1 —— 实测 `+61: All tests passed!`（含 gl_state_test.dart 全部新增用例）
- [x] T051 `pnpm --filter @ufjs/webgl test`、`pnpm --filter @ufjs/webgl typecheck`、`pnpm --filter hello-fjs run typecheck` 通过 —— spec 验收 2 —— 实测 vitest 29/29 passed；两个 typecheck exit=0
- [x] T052 Android 真机 M2007J17C debug（`fjs run android --device 94629393`）：三角形 → 返回 → 实例化、three.js glTF → 返回 → 实例化均正常；release（`--release`）重复 —— spec 验收 3 —— **debug 已验**：两个顺序均正常、前后两帧不同（在动）、logcat 无 CanvasOp / stream dropped；**release 未验** （**跳过**：用户 2026-09-11 确认基本测试已通过，验收到此为止）
- [x] T053 iOS 模拟器（`fjs run ios`）同 T052 两个顺序 —— spec 验收 4 —— **顺序 1 已验**（iPhone 17 Pro / iOS 26.3：三角形 → 返回 → 实例化正常）；顺序 2 未验 （**跳过**：用户 2026-09-11 确认基本测试已通过，验收到此为止）
- [x] T054 并存：三角形页离场转场中途点实例化；临时两 canvas 调试页（**不提交**，验完删）双方画面正确 —— spec 验收 5 —— **转场中途已验**（真机：三角形页返回后 0.15s 点实例化，正常出图）；两 canvas 调试页已建未跑（dev reload 打断），已删除 （**跳过**：用户 2026-09-11 确认基本测试已通过，验收到此为止）
- [x] T055 回归：三角形 / 实例化 / three.js glTF / glTF 手写 / 3D 飞机大战 单独打开与修改前一致，`adb logcat | grep '\[fjs\] webgl'` 无新增报错；glTF 两个按需渲染页复跑 spec 028 T033–T035 呈现检查 —— spec 验收 6 （**跳过**：用户 2026-09-11 确认基本测试已通过，验收到此为止）
- [x] T056 `fjs run android --profile`：3D 飞机大战修改前后帧耗时对比，数值记在本条 —— spec 验收 7 （**跳过**：用户 2026-09-11 确认基本测试已通过，验收到此为止）
- [x] T057 文档 T040–T041 已落 —— spec 验收 8；spec.md 第 6 节核对：1、2、8 通过；3 debug 通过 release 跳过；4 顺序 1 通过；5 转场并存通过、双 canvas 页跳过；6、7 跳过
