# JSI 机制与原生模块编写指南

> 第一层第 4 篇。前置：[原理](principles.md)、[线程模型](threading-model.md)、
> [整体架构](architecture.md)。
>
> 大多数"加一个原生能力"的需求**不需要写 C++** —— 先看
> [modules.md](modules.md) 的 Dart 侧 widget 扩展够不够用。

flutter-js 的"JSI"指：JS 引擎（QuickJS-ng）以 C++ 源码嵌入应用，宿主函数
通过 `JS_NewCFunction` 直接收发 `JSValue`——**JS 与 C++ 之间没有 JSON、没有
桥接序列化**，与 React Native 的 JSI 设计目标一致。

## 三条通信通道

### 1. JS → C++：内建 natives（natives.cpp）

```js
__fjs.natives.fibonacci(10);      // 纯 C++ 函数，JSValue 直进直出
__fjs.fns.invokeHost('device');   // 转发到 Dart 宿主模块
__fjs.fns.uiOps(u8Array);         // UI 帧 → Dart（ArrayBuffer 直读）
__fjs.fns.nowMs();                // 引擎单调时钟
```

`__fjs` 有类型声明，随 `@ufjs/runtime` 发布在
`packages/fjs-runtime/src/native-global.d.ts`，工程侧靠那一行
`/// <reference types="@ufjs/runtime/ambient" />` 一起带进来（见
[vue3.md](vue3.md) 的「编辑器提示」一节）。两点由类型强制：

- `__fjs` 的类型是 `FjsNative | undefined`——web 构建没有引擎，必须先判空。
  日常代码别直接碰它，走 `fjs` 导出的 `invokeHost` / `nowMs` / `toast` /
  `hasNativeHost`，那层已经处理了没有宿主的情况。
- `invokeHost` 的可变参类型是 `FjsHostValue`（`string | number | boolean |
  null`），也就是下面那张 v1 ABI 表。传对象会在编译期就被拦下来，而不是在
  边界上静默变成 null。

这个 d.ts 是手写的，`natives.cpp` 改了要跟着改——它是这条边界唯一的类型描述。

`fibonacci` 的完整实现（`natives.cpp`，零序列化的示范）：

```cpp
static JSValue js_fibonacci(JSContext *ctx, JSValueConst this_val,
                            int argc, JSValueConst *argv) {
    int64_t n = 0;
    if (JS_ToInt64(ctx, &n, argv[0]) != 0)
        return JS_ThrowTypeError(ctx, "fibonacci(n): n must be an integer");
    return JS_NewInt64(ctx, fib(n));   // 直接构造 JSValue 返回
}
```

### 2. JS → Dart：宿主模块（invokeHost）

JS 侧：

```ts
import { invokeHost } from 'fjs';
const info = invokeHost<{ platform: string }>('device', 'get', 42);
```

Dart 侧（`engine.dart` 的 HostRegistry）：

```dart
engine.host.register('device', (args) => {
  'platform': Platform.operatingSystem,
  'args': args,
});
```

调用同步完成。参数与返回值跨越的是 tagged C 结构 `FJSValue`
（null/bool/int32/double/string），字符串为 utf8。对象/数组 v1 以字符串形式
跨越，结构化句柄在 [roadmap](roadmap.md#近期计划)。

### 3. C++ → Dart：UI 帧回调

`fjs_set_callbacks` 安装 Dart 函数指针（`NativeCallable.isolateLocal`）：

- `on_log` — console 输出
- `on_ui_ops` — 二进制 UI 帧（协议表见 [architecture.md](architecture.md#ui-帧协议二进制)）
- `on_invoke_host` — 上面第 2 条的 C 侧入口

## 编写 C++ 原生模块（进阶）

1. 在 `native/src/natives.cpp` 增加函数并安装到 `__fjs.natives`：

```cpp
static JSValue js_battery(JSContext *ctx, JSValueConst, int, JSValueConst *) {
    JSValue obj = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, obj, "level", JS_NewFloat64(ctx, 0.87));
    return obj;
}
// install_natives():
JS_SetPropertyStr(ctx, natives, "battery",
                  JS_NewCFunction(ctx, js_battery, "battery", 0));
```

2. JS 侧（可在 @ufjs/runtime 里包一层类型定义）：

```ts
const battery = __fjs.natives.battery() as { level: number };
```

注意 QuickJS 的引用规则：`JS_New*` 返回的引用由调用方释放；从对象上
`JS_Get*` 拿到的引用需要 `JS_FreeValue`。C++ 侧返回 `JSValue` 给引擎时
不要释放。

## 内存与时序契约（fjs.h）

- `fjs_invoke_host` 的出参字符串：宿主 **malloc**，引擎在 JSValue 转换后
  **free**（Dart 侧 `package:ffi` 的 malloc 与 libc malloc 同源）。
- 入参字符串仅在本次调用内有效，宿主如需保留必须复制。
- `JS_Eval` 要求源码缓冲区 `src[len] == '\0'`——引擎层已统一处理
  （`nul_terminated()`），调用方传入裸字节即可。

## 离线验证（不启动 Flutter）

```bash
cd packages/flutter_fjs/native
cmake -B build-native -DFJS_BUILD_TESTS=ON && cmake --build build-native -j
./build-native/fjs-test                 # 引擎自测（ALL PASS）
./build-native/fjsrun dist/bundle.js    # 跑你的 bundle，打印 console + UI 帧
./build-native/fjsrun --tap 3 dist/bundle.js   # 模拟点击节点 #3
```

## fetch：异步宿主模块的范式

QuickJS 没有 socket，`fetch` 由 Dart 的 `HttpClient` 实现（`lib/src/http.dart`），
走的仍是上面那两条通道——**没有新的 C ABI**：

```
JS                          Dart                                   JS
fetch(url)  -> invokeHost('fjs.http.request', id, requestJson)
            <- dispatchEvent(id, 14 /* httpResponse */, resJson) -> promise 落定
ctrl.abort()-> invokeHost('fjs.http.abort', id)
```

`invokeHost` 是同步的（JSI host function），所以请求处理器只**发起**请求就返回，
UI 线程不会被网络阻塞；`id` 由 JS 侧分配，与 worker 句柄同样是一个纯数字，
Promise 存在 JS 侧的 pending 表里等事件回来。**任何需要异步返回的宿主模块都照这个
形状写**：invokeHost 交出请求 + 一个自己分配的 id，dispatchEvent 送回结果。

请求体和响应体都以 base64 跨界：v1 ABI 只有字符串，base64 能让二进制（图片、
protobuf）原样过去，`res.text()` 在 JS 侧自己做 utf8 解码。

JS 侧的表面是 WHATWG 的子集——没有流式 body，响应整体到达：

```ts
const res = await fetch('https://api.example.com/items', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ q: 'hi' }),
  timeout: 5000,          // fjs 扩展；标准里没有
});
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const items = await res.json();
```

- 4xx/5xx 和 web 一致：**resolve**，不 reject；只有传输失败（DNS、连接、超时、
  abort）才 reject。
- web 构建没有原生宿主，`fetch` 转发浏览器的 fetch。`timeout` 和本运行时的
  `AbortController`（QuickJS 没有，运行时自带一个）浏览器都不认识，web 这一侧
  会把它们桥接到真正的 `AbortSignal` 上，所以两端行为一致。
- `fetch` / `Headers` / `Response` / `AbortController` 也装成全局——和 timers
  一样，只在**有原生宿主时**装，且不覆盖环境已有的，第三方库里的裸 `fetch`
  因此能跑。类型不用声明：项目默认 lib 已经带了这四个名字。

  但要注意：web 上的全局 `fetch` 是**浏览器自己的**，不认 `timeout`。要两端
  完全一致就 `import { fetch } from 'fjs'`（demo 的 src/pages/fetch.vue 就是
  这么写的）；`RequestInit.timeout` 的类型由 `@ufjs/runtime/ambient` 合并进来。

在 demo 里可以直接看到跑起来的样子：`/fetch` 这一页拿 dog.ceo 和 httpbin.org
做了 7 项在线验证（json、二进制图片、POST body、自定义请求头、404、超时、
abort），Flutter 和 web 跑同一份源码。
