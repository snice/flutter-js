# Plan: WebGL 实例化绘制

对应 [spec.md](spec.md)。

## 宪法自查

- I 两端同源：web 原生已有；App 补命令流。✅
- II 边界即契约：三张表不动；模块协议 `protocol.ts` ↔ `replay.dart` 同一个提交里改。✅
- III 同步单线程：纯命令流追加，不引入查询。✅
- V 静默失效：示例页对不支持的 context 显示说明；文档纠正「warn-once」的错误描述。✅
- VIII 文档：canvas-compat / roadmap / index.ts 注释。✅

## 改动

| 层 | 文件 | 改什么 |
|---|---|---|
| JS 协议 | `packages/fjs-webgl/src/protocol.ts` | `WebglCmd.DrawArraysInstanced = 0x0606`、`DrawElementsInstanced = 0x0607`；writer 两个方法；头注释的编号空间说明 |
| JS context | `packages/fjs-webgl/src/context.ts` | `drawArraysInstanced` / `drawElementsInstanced` 转发 writer |
| Dart 协议 | `packages/fjs-webgl/flutter/lib/src/replay.dart` | `WebglCmd` 常量、`FjsGlBindings` 抽象方法、decoder 两个 case、`FjsAngleBindings` 转发 flutter_angle |
| 测试 | `test/webgl-protocol.test.ts`、`flutter/test/webgl_replay_test.dart` | 两端 round-trip；Dart fake 补实现 |
| 注释 / 文档 | `index.ts`、`docs/canvas-compat.md`、`docs/roadmap.md` | instancing 双端可用 |
| 示例 | `examples/hello-fjs/src/pages/example/webgl-instanced.vue` | 手写 GL：60 方块 elements 实例化 + 12 三角形 arrays 实例化 |

## 关键决定

- **编号放 draw 家族（0x06xx）而不是 WebGL2 预留段**：`vertexAttribDivisor` 已按「指令家族」
  进了 0x05xx，instanced draw 本质是 draw，放 0x0606/0x0607 紧挨 `DrawArrays`/`DrawElements`，
  解码侧字段读法也一目了然。
- **示例用手写 GL 不用 three**：两条指令各自有一次可见的调用，出问题时能直接定位到哪条；
  three 的 `InstancedMesh` 只会走 `drawElementsInstanced`。
- **不做扩展形态**：`ANGLE_instanced_arrays` 要在 JS 侧造一个扩展对象并改 `getExtension`
  的「一律 null」约定，收益是 WebGL1-only 环境，而 App 端本来就是 GLES3。

## 验证顺序

vitest → flutter test → typecheck ×2 → build:pages → web 预览 → iOS 模拟器。
