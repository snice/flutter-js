# Tasks: WebGL 实例化绘制

- [x] T1 `protocol.ts`：两个指令 id + writer 方法
- [x] T2 `context.ts`：两个 context 方法（顺带补 `NumericArg` 的 `Uint16Array` 等整数视图类型）
- [x] T3 `replay.dart`：常量、抽象方法、decoder case、flutter_angle 转发
- [x] T4 TS 测试 round-trip（经 context 发出）—— vitest 29/29
- [x] T5 Dart 测试：fake 补实现 + 解码参数核对 —— flutter test 14/14
- [x] T6 `index.ts` 注释、`canvas-compat.md`、`roadmap.md`
- [x] T7 示例页 `webgl-instanced.vue`
- [x] T8 vitest / flutter test / typecheck ×2 / build:pages
- [x] T9 web 预览验证（60 方块 + 12 三角形在脉动）
- [x] T10 iOS 模拟器验证（iPhone 17 Pro / iOS 26.3，`fjs run ios` 重编宿主：两组图形在脉动，前后两帧不同；日志只有 first present，无 CanvasOp / not a function）
