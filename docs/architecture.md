# flutter-js 架构

## 分层总览

```
┌────────────────────────────────────────────────────┐
│ JS/TS 应用层（npm 生态）                            │
│   .ts / .js / .vue SFC → esbuild 打包为单文件        │
│   依赖 vue3 等任意 npm 包（QuickJS 支持 Proxy）      │
├────────────────────────────────────────────────────┤
│ fjs-runtime（npm 包，打包进 bundle）                 │
│   element API（h/create/setProps/setText）          │
│   UI 帧批量提交（op writer → Uint8Array）            │
│   Vue3 自定义渲染器（createRenderer + nodeOps）      │
├──────────────── JSI 边界 ──────────────────────────┤
│ libfjs（C++，vendored QuickJS-ng 0.9.0）            │
│   JS_NewCFunction 宿主函数：JS 值直传，无序列化       │
│   console / timers / uiOps / invokeHost natives     │
│   源码 eval（NUL 结尾约束）/ 字节码 ReadObject        │
├──────────────── dart:ffi（纯 C ABI）────────────────┤
│ flutter_jsc（Flutter 插件）                          │
│   NativeCallable.isolateLocal 同步回调               │
│   镜像树（MirrorTree）→ Flutter Widget               │
│   手势/文本事件 → fjs_vm_dispatch_event              │
└────────────────────────────────────────────────────┘
```

## 一次点击的完整旅程（事件闭环）

1. Flutter `GestureDetector.onTap` → `engine.dispatchEvent(nodeId, FJS_EVENT_TAP)`
2. Dart FFI → `fjs_vm_dispatch_event`（C++）
3. C++ `JS_Call(__fjsDispatchEvent, nodeId, 1, null)` — 同步调用 JS
4. fjs-runtime 的事件注册表找到该节点的 onTap 处理器并执行
5. 处理器调用 `setText(...)` → op 写入帧缓冲 → `queueMicrotask(flush)`
6. dispatch 返回前 C++ 泵空微任务（`fjs_vm_pump`）→ `__fjs.fns.uiOps(frame)` 同步回调 Dart
7. Dart 应用 op 到镜像树 → `notifyListeners()` → Flutter 本帧重建

**整条链路在一次手势回调内同步完成，无跨线程、无 JSON 序列化。**

## UI 帧协议（二进制）

JS 每个微任务把节点操作聚合为一个 frame（`Uint8Array`），一次 `uiOps()` 调用提交。
小端序，操作码见 `packages/flutter_jsc/lib/src/ui_ops.dart` 与
`packages/fjs-runtime/src/ui/ops.ts`（两者必须同步修改）：

| op | 名称 | 载荷 |
|----|------|------|
| 1 | CREATE | u32 id, u16 tagLen, utf8 tag |
| 2 | REMOVE | u32 id |
| 3 | INSERT | u32 parent, u32 child, u32 index |
| 4 | REMOVE_CHILD | u32 parent, u32 child |
| 5 | SET_TEXT | u32 id, u32 len, utf8 |
| 6 | SET_PROPS | u32 id, u32 len, utf8 JSON |

- parent id `0` 表示宿主隐式根容器
- props 是扁平 JSON 对象（style/onTap 标记/value 等），v1 用 JSON 是性能与
  通用性的折中；值类型都是字符串/数字/布尔

## 线程模型（v1）

- **JS 全部运行在 Flutter UI isolate 线程**，原生调用全部同步。
- Dart 通过 16ms `Timer.periodic` 驱动 `fjs_vm_pump(fjs_vm_now(vm))`：
  执行到期 timers + promise 微任务（上限 10000 次/帧，防止微任务风暴卡帧）。
- 回调使用 `NativeCallable.isolateLocal`（仅限拥有 isolate 的线程调用）。
- VM 实例持有线程宿主单例（`HostBridge.install`），v1 每个进程一个 engine。
- Worker 线程 / isolate 隔离在 roadmap 中规划。

## 生命周期

```
FjsEngine() → fjs_vm_create（QuickJS runtime + context + natives）
addPrelude(chunk) → 共享块 eval（每次 reset 自动重放，见 docs/toolchain.md）
runSource/runBundle → eval → 泵微任务 → （首帧 UI ops 到镜像树）
startEventLoop → 周期性 pump
connectDev(host, port) → HTTP 拉 bundle → WS 监听 reload → reset() 重建 VM
dispose → fjs_vm_destroy
```

`reset()` 销毁 VM 并清空镜像树，全局对象随之消失，因此 prelude（分包出来的
共享运行时）由 engine 在新 VM 里重新 eval，宿主不必自己排序。

## 关键文件索引

| 层 | 文件 |
|----|------|
| C ABI | `packages/flutter_jsc/native/include/fjs.h` |
| VM/字节码 | `packages/flutter_jsc/native/src/vm.cpp` |
| natives（JSI）| `packages/flutter_jsc/native/src/natives.cpp` |
| FFI 绑定 | `packages/flutter_jsc/lib/src/ffi.dart` |
| 引擎宿主 | `packages/flutter_jsc/lib/src/engine.dart` |
| 镜像树 | `packages/flutter_jsc/lib/src/mirror_tree.dart` |
| 渲染层 | `packages/flutter_jsc/lib/src/render/`（renderer 分发 + flex/decoration/gesture/style）|
| 单个标签组件 | `packages/flutter_jsc/lib/src/widgets/` |
| 注册表 | `packages/flutter_jsc/lib/src/registry/`（host 模块 / Dart 组件）|
| op 编码（JS）| `packages/fjs-runtime/src/ui/ops.ts` |
| element API | `packages/fjs-runtime/src/ui/element.ts` |
| Vue 渲染器 | `packages/fjs-runtime/src/vue/renderer.ts` |
| CLI | `packages/fjs/src/{build,dev}.ts` |
