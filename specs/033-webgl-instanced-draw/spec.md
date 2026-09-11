# Spec: WebGL 实例化绘制（drawArraysInstanced / drawElementsInstanced）

- **ID**: 033-webgl-instanced-draw
- **状态**: done
- **日期**: 2026-09-11
- **前置**: 021（webgl 模块）、023（VAO / vertexAttribDivisor）、032（飞机大战绕开了 instancing）

## 1. 要解决什么

App 端的 `@ufjs/webgl` context 上**没有** `drawArraysInstanced` / `drawElementsInstanced`：

- three.js 的 `InstancedMesh` 走 `gl.drawElementsInstanced`（索引几何）/ `gl.drawArraysInstanced`，
  App 端调用即 `TypeError: not a function`，整页渲染中断；手写 GL 同样。
- web 端透传浏览器原生 WebGL2 context，本来就能用 —— 两端不一致。
- 文档（`docs/canvas-compat.md`、`index.ts` 注释）写的是「App warn-once」，与实际不符：
  context 原型链末端的 Proxy 只对**大写常量名**告警，缺失的方法读出来就是 `undefined`。

spec 032 的飞机大战为此改用「CPU 批量写顶点」绕开；大批量同形物体（粒子、草、弹幕、
点云）没有 instancing 就只能每帧 CPU 逐顶点写数据。

`vertexAttribDivisor` 已在 023 进了协议（three 每帧对普通属性也调它），宿主
`flutter_angle` 0.4.2 的原生 wrapper 也已有两个 instanced draw —— 缺的只是命令流里这两条指令。

## 2. 不做什么（Non-goals）

- 不提供 WebGL1 的 `ANGLE_instanced_arrays` 扩展：`getExtension()` 仍返回 `null`。
  instancing 按 WebGL2 core 提供（页面照旧 `getContext('webgl2') ?? getContext('webgl')`）。
- 不做 `drawBuffers`（MRT）、`WEBGL_multi_draw`（three 的 `BatchedMesh`）、
  `vertexAttribIPointer`、query 对象 —— 各自另开 spec。
- 不改 spec 032 的飞机大战（Batch 写法保留，它本身就是一个有效示例）。
- 不在 JS 侧校验负数 count / instanceCount：与现有 `drawArrays` 的编码保持一致
  （u32 上线，交给驱动报错）。

## 3. 用户可见的行为

页面代码与浏览器 WebGL2 完全一致，两端都能跑：

```ts
const gl = canvas.getContext('webgl2')!;
gl.vertexAttribDivisor(aOffset, 1);   // 023 已有
gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, 60);
gl.drawArraysInstanced(gl.TRIANGLES, 0, 3, 12);
```

three.js 的 `InstancedMesh` 在 App 端随之可用。

顺带修一处类型缺口（写示例时撞上）：`bufferData` / `bufferSubData` 的参数类型
`NumericArg` 不含 `Uint16Array`（WebGL 的标准索引类型）等整数视图，页面上传索引
缓冲会报类型错误。运行时 `toBytes` 本就按任意 `ArrayBufferView` 取字节，只补类型。

hello-fjs 新增示例页「画布演示 / WebGL 实例化」：上半 60 个方块一次
`drawElementsInstanced`，下半 12 个三角形一次 `drawArraysInstanced`，位置与颜色走
divisor=1 的实例属性，uniform 驱动脉动动画。context 不支持时（WebGL1 回落）页面
显示说明文字而不是报错。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | 编码为 `DrawArraysInstanced` 0x0606 / `DrawElementsInstanced` 0x0607，宿主经 flutter_angle 执行 `glDrawArraysInstanced` / `glDrawElementsInstanced`（ANGLE GLES3） | 浏览器原生 context，不经 fjs |
| 事件载荷 | 不涉及 | 不涉及 |
| 已知差异 | 无（WebGL1 回落的 context 两端都没有 instancing） | |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及 —— 变的是 op 11 **载荷**里的 webgl 命令流（模块协议），
  `packages/fjs-webgl/src/protocol.ts` 与 `flutter/lib/src/replay.dart` 同步改。

编码：

| 指令 | id | 字段 |
|---|---|---|
| DrawArraysInstanced | 0x0606 | u32 mode, i32 first, u32 count, u32 instanceCount |
| DrawElementsInstanced | 0x0607 | u32 mode, u32 count, u32 type, i32 offset, u32 instanceCount |

与同族的 `DrawArrays` / `DrawElements` 前几个字段完全相同，instanceCount 放最后。

## 6. 验收标准

1. `pnpm --filter @ufjs/webgl test` 通过（新增编码 round-trip，经 context 方法发出）。
2. `cd packages/fjs-webgl/flutter && flutter test` 通过（新增解码 → bindings 调用，参数逐个核对）。
3. `pnpm --filter @ufjs/webgl typecheck`、`pnpm --filter hello-fjs run typecheck`、`build:pages` 通过。
4. web 预览 `/example/webgl-instanced`：方块网格与三角形一排在脉动，控制台无报错。
5. iOS 模拟器同页：画面与 web 一致，无 `TypeError` / `[fjs] webgl` 报错。
6. `docs/canvas-compat.md`、`docs/roadmap.md`、`index.ts` 注释更新为「instancing 双端可用」。

## 7. 待澄清

无。
