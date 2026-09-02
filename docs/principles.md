# 原理：flutter-js 为什么是这个形状

> 第一层第 1 篇。读完这篇你会知道 fjs 的五个基本决策，以及它和
> React Native / WebView 方案的根本差别。后续篇章都建立在这五条上。
>
> 下一篇：[线程模型与执行时序](threading-model.md)

## 一句话

**把 JS 引擎编进 Flutter 应用，让 JS 直接调 C++ 函数、直接调 Dart 函数，
中间没有桥、没有 JSON、没有跨线程。**

## 决策一：嵌引擎，不用 WebView

WebView 方案（Cordova / uni-app 的 H5 端）里，JS 和原生是两个进程/两套渲染，
所有交互过 `postMessage` 的字符串桥。fjs 把 **QuickJS-ng 0.9.0 以 C++ 源码
vendored 进仓库**（`packages/flutter_fjs/native/quickjs/`），编成 `libfjs`
和应用链在一起：

| | WebView | fjs |
|---|---|---|
| 渲染 | 浏览器排版引擎 | Flutter Widget（和手写 Flutter 同一条渲染管线）|
| JS↔原生 | 字符串桥，异步 | C 函数调用，同步 |
| 包体 | 系统 WebView（但受版本碎片影响）| +约 1MB `libfjs.so` |
| 调试 | Chrome DevTools | `fjs log` / `fjs eval` / `fjsrun` |

代价是**没有 DOM、没有 CSS 排版引擎**。所以 fjs 自己实现了一个 CSS 子集
（见 [css-compat.md](css-compat.md)），能支持的和不能支持的边界是明确的。

## 决策二：JSI 式直调，不做序列化桥

"JSI" 在这里指：宿主函数用 `JS_NewCFunction` 注册，**直接收发 `JSValue`**。

```cpp
// native/src/natives.cpp —— 零序列化的最小示范
static JSValue js_fibonacci(JSContext *ctx, JSValueConst, int argc, JSValueConst *argv) {
    int64_t n = 0;
    if (JS_ToInt64(ctx, &n, argv[0]) != 0)
        return JS_ThrowTypeError(ctx, "fibonacci(n): n must be an integer");
    return JS_NewInt64(ctx, fib(n));
}
```

JS 侧 `__fjs.natives.fibonacci(10)` 就是一次普通 C 函数调用。同理
`invokeHost` 转发到 Dart 宿主模块，也是同步返回。

**v1 ABI 只过标量**（`string | number | boolean | null`），这是刻意的取舍：
标量能覆盖绝大多数调用，而结构化句柄（`JS_GetOpaque` 持 C++ 指针）会把内存
所有权规则复杂化。需要传对象就 JSON 字符串，需要传二进制就 base64 ——
`fetch` 的图片响应就是这么过来的。结构化句柄在 [roadmap](roadmap.md) 里。

细节见 [JSI 与原生模块](jsi-and-native-modules.md)。

## 决策三：UI 是二进制帧，不是逐节点调用

如果每次 `setText` 都跨一次边界，一个 v-for 列表更新就是几千次调用。fjs 的做法：
**JS 侧把一个微任务内的所有节点操作聚合成一个 `Uint8Array`，一次
`uiOps(frame)` 提交**。

```
create(view) ─┐
insert(...)   ├─► OpWriter 累积 ─► queueMicrotask(flush) ─► uiOps(frame) ─► Dart
setProps(...) ─┘                                              一次调用
```

协议只有 6 个 opcode（CREATE / REMOVE / INSERT / REMOVE_CHILD / SET_TEXT /
SET_PROPS），小端序，定义在
[`ui/ops.ts`](../packages/fjs-runtime/src/ui/ops.ts) 和
[`ui_ops.dart`](../packages/flutter_fjs/lib/src/ui_ops.dart) ——
**这两个文件是同一份协议的两半，必须同时改**。完整表见
[architecture.md](architecture.md#ui-帧协议二进制)。

Dart 侧把帧应用到**镜像树**（`mirror_tree.dart`），镜像树
`notifyListeners()` 触发 Flutter 本帧重建。JS 不持有 Widget，Dart 不持有
JS 对象，两边各自管各自的生命周期。

## 决策四：渲染层框架无关

JS 侧对外的不是"Vue 支持"，而是一套**命令式 element API**：

```ts
const box = create('view');
setProps(box, { style: { padding: 16 } });
insert(root, box);            // 微任务结束时聚合成一帧提交
```

`examples/hello-js` 就是完全不用框架、直接调它写的。前端框架是坐在这层上面的
一个适配器，把自己的树操作映射到这五个函数：

| 框架 | 接入点 | 状态 |
|---|---|---|
| Vue 3 | `createRenderer(nodeOps)` | **已实现**，约 200 行 |
| React | `react-reconciler` 的 host config | 理论可接，见 roadmap |
| Solid | `solid-js/universal` 的 `createRenderer` | 理论可接 |
| 自研 | 直接调 element API | 随时 |

所以"支持哪个框架"是适配层的事，**element API 和 op 协议这两层里不应该出现
任何框架假设**。接入步骤、Vue 渲染器里三个非显然的实现点、以及接 React 前
需要先做的共享重构，都在 [custom-renderer.md](custom-renderer.md)。

## 决策五：一份源码，两个渲染后端

同一份 `.vue` 既能编成 Flutter 应用，也能编成浏览器静态站点：

| | Flutter 目标 | Web 目标 |
|---|---|---|
| Vue 运行时 | `@vue/runtime-core` + fjs 自定义 renderer | `vue` 官方 runtime-dom |
| `<view>` `<swiper>` | Dart 侧 Widget（**元素**）| `fjs/web` 的 Vue 组件（**组件**）|
| `<style scoped>` | fjs 自己的 CSS 引擎 | 真 CSS |
| 路由 | 原生 Navigator | vue-router |

切换点在 SFC 编译时传给 `@vue/compiler-dom` 的不同 `isNativeTag`。
这条约束（宪法 I「两端同源」）是 fjs 所有功能设计的第一约束：
**只做一端等于没做**。差异清单见 [web.md](web.md) 和 [css-compat.md](css-compat.md)。

## 两种运行形态

| | dev | release |
|---|---|---|
| 产物 | JS 源码 bundle，HTTP 拉取 | QuickJS 字节码 `.fjsbundle` |
| 加载 | `JS_Eval` | `JS_ReadObject`（跳过解析）|
| 更新 | WebSocket 推 reload → `reset()` 重建 VM | 随包发布 |
| 校验 | — | engine id 匹配，版本不符拒绝加载 |

字节码由 `fjsc` 编译，它和运行时是**同一份 QuickJS 源码**编出来的 ——
所以改了 `native/` 必须重编 `fjsc`，否则字节码和引擎对不上。

## 接下来读什么

- 想知道这些同步调用是怎么排进 Flutter 帧里的 → [线程模型](threading-model.md)
- 想看完整分层和文件索引 → [整体架构](architecture.md)
- 想写一个原生模块 → [JSI 与原生模块](jsi-and-native-modules.md)
- 想接 React → [自定义渲染器](custom-renderer.md)
