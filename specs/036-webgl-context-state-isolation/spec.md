# Spec: webgl 画布间 GL 状态隔离

- **ID**: 036-webgl-context-state-isolation
- **状态**: done（验收部分跳过，见 tasks.md T052–T057）
- **日期**: 2026-09-11
- **前置**: 021（webgl 模块）、023（VAO）、028（呈现路径 / `_activate`）、033（实例化示例页，本问题的首个受害者）

## 1. 要解决什么

App 端先打开「画布演示 / WebGL 三角形」，返回，再打开「WebGL 实例化」：画布只剩清屏色，
方块和三角形一个都没有。单独打开「WebGL 实例化」则完全正常。web 端两种顺序都正常。

真机复现：M2007J17C（Redmi / Android 11，Adreno 619，ANGLE → Vulkan），debug 与 release 都复现。

根因：

- flutter_angle 0.4.2 在**所有平台**上只有一个 EGL context —— Android JNI 的 `g_context`、
  Apple/桌面的 `_baseAppContext` —— 每张画布只是一个挂在它上面的 surface/FBO。
- `FjsWebglRuntime._activate`（`replay.dart`）切换画布时只做 `texture.activate()`（换绑 surface），
  **GL context 状态整体共享**。
- 三角形页 `gl.enable(gl.DEPTH_TEST)` 后不复位；实例化页从不碰深度、只清 `COLOR_BUFFER_BIT`，
  于是新 surface 上所有片元深度测试失败。临时在实例化页加 `g.disable(g.DEPTH_TEST)` 即恢复，已证实。

浏览器语义是每次 `getContext` 得到一个**独立**的 context，初始状态为 WebGL 规范默认值。
App 端违背了这一点，表现为「页面代码没问题，换个打开顺序就黑」—— 典型的静默失效（宪法 V）。

串扰不止深度测试。所有 **context 级**状态都会漏：

| 类别 | 例 |
|---|---|
| 开关 | `BLEND` `CULL_FACE` `DEPTH_TEST` `DITHER` `POLYGON_OFFSET_FILL` `SAMPLE_ALPHA_TO_COVERAGE` `SAMPLE_COVERAGE` `SCISSOR_TEST` `STENCIL_TEST` `RASTERIZER_DISCARD` |
| 标量状态 | `blendColor/Equation/Func`、`clearColor/Depth/Stencil`、`colorMask`、`cullFace`、`depthFunc/Mask/Range`、`frontFace`、`lineWidth`、`pixelStorei`、`polygonOffset`、`sampleCoverage`、`scissor`、`stencilFunc/Mask/Op`（含 Separate）、`viewport` |
| 绑定 | `useProgram`、`bindVertexArray`、`bindBuffer`（ARRAY_BUFFER 等非 VAO 目标）、`bindFramebuffer`、`bindRenderbuffer`、`activeTexture` + 各纹理单元上的 `bindTexture` |
| 默认 VAO 上的顶点属性 | `enable/disableVertexAttribArray`、`vertexAttribPointer`、`vertexAttribDivisor`、`ELEMENT_ARRAY_BUFFER`；以及 context 级的通用属性值 `vertexAttrib1f…4fv` |

（uniform 值、纹理参数、buffer 内容挂在各自的 GL 对象上，对象按画布分配，不串。）

两种触发场景都要覆盖：

1. **先后**：上一个 webgl 页销毁后，下一个页面的 context 继承了残留状态（本次复现）。
2. **并存**：两张 webgl 画布同时在跑、命令流在同一 context 上交替执行 —— push 新页时下层页仍挂载
   （路由「出栈即销毁」，入栈不销毁）、pop 的页在离场转场期间还活着、tab 页保活、一页多张画布。
   只在建 context 时复位修不了这一类。

## 2. 不做什么（Non-goals）

- **不改页面**：不在示例页里补 `disable(DEPTH_TEST)` 之类的防御代码；修在宿主。
- 不给每张画布建独立 EGL context（需要改 flutter_angle 原生层，且共享 context 是插件的前提）。
- 不改 JS 侧 `@ufjs/webgl` 与命令流协议：状态从已有指令里就能记账。
- 不做 `getParameter` 读状态的新能力；若现有查询路径读 GL，只需保证读到的是本画布的状态（见验收 5）。
- 不处理 flutter_angle 未实现的调用（`hint` 等，照旧 warn-once）。
- 不追求切换零开销的极致优化；但单画布页面不应多付代价（见验收 7）。

## 3. 用户可见的行为

页面代码不变，与浏览器一致：每张画布 `getContext` 拿到的 context 从 WebGL 默认状态开始，
且不受其他画布影响。

```ts
// 页面 A（三角形）
gl.enable(gl.DEPTH_TEST);
gl.enable(gl.CULL_FACE);

// 页面 B（之后或同时打开）—— 不需要任何防御性复位
const gl = canvas.getContext('webgl2')!;
gl.getParameter(gl.DEPTH_TEST); // false，同浏览器
gl.clear(gl.COLOR_BUFFER_BIT);
gl.drawElementsInstanced(...);   // 正常出图
```

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | 宿主为每张画布维护自己的 context 状态：新画布从 WebGL 默认值开始；切到某张画布执行命令前，GL 状态恢复成该画布上次离开时的样子 | 浏览器原生 context，本来就是隔离的，不改 |
| 事件载荷 | 不涉及 | 不涉及 |
| 已知差异 | 无（修完后消除现有差异） | |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及 —— 只改 `packages/fjs-webgl/flutter/lib/src/replay.dart` 宿主执行层，webgl 命令流不变

## 6. 验收标准

1. `cd packages/fjs-webgl/flutter && flutter test` 通过，新增：
   - 画布 A 设置一组状态（覆盖 §1 表里每个类别至少一项）后，新建画布 B 的首次执行前，
     bindings 收到把这些状态恢复为 WebGL 默认值的调用；
   - A、B 交替执行命令时，每次切换后 GL 看到的状态等于该画布自己最后设置的值；
   - 同一画布连续执行（不切换）时不发出任何额外的恢复调用。
2. `pnpm --filter @ufjs/webgl test`、`pnpm --filter @ufjs/webgl typecheck` 通过（确认 JS 侧未动）。
3. Android 真机（M2007J17C）`fjs run android`：「WebGL 三角形」→ 返回 →「WebGL 实例化」，
   方块网格与三角形一排正常脉动；再依次「three.js glTF」→ 返回 →「WebGL 实例化」同样正常。
   release（`fjs run android --release`）重复一次。
4. iOS 模拟器同第 3 条的两个顺序，画面正常。
5. 并存场景：两张 webgl 画布同时渲染（在「WebGL 三角形」页上 push 另一个 webgl 页，
   或转场中途返回），双方画面都正确，没有闪到对方的状态（例如三角形页不出现被剔除 / 混合异常）。
6. 回归：「WebGL 三角形」「WebGL 实例化」「three.js glTF」「glTF 模型（手写）」「3D 飞机大战」
   单独打开均与修改前一致；logcat 无新增 `[fjs] webgl` 报错。
7. 单画布页面不多付切换代价：「3D 飞机大战」连续渲染时帧耗时与修改前持平（`fjs run android --profile` 对比，
   无可见退化即可，数值记进 tasks.md）。
8. `docs/canvas-compat.md` webgl 行补一句「每张画布 context 状态独立（App 端宿主记账恢复，spec 036）」。

## 7. 待澄清

- [x] **修法取舍** → 按画布记账、切换时恢复（覆盖先后 + 并存）。用户 2026-09-11 确认。
- [x] **默认 VAO 上的顶点属性** → 每张画布一个隐藏 VAO 充当它的「默认 VAO」，页面
  `bindVertexArray(null)` 映射到它，属性状态天然按画布隔离。用户 2026-09-11 确认。
- [x] **切换时恢复的粒度** → diff：只对与 GL 当前值不同的项发调用。用户 2026-09-11 确认。
