# 线程模型与执行时序

> 第一层第 2 篇。上一篇：[原理](principles.md)　下一篇：[整体架构](architecture.md)
>
> 一句话：**JS 全部跑在 Flutter 的 UI isolate 上，所有原生调用同步返回；
> 唯一的真并行是 Worker，它是另一个 isolate 里的另一个 QuickJS runtime。**

## 主线程：一个 isolate，一个 VM

```
Flutter UI isolate
├── Flutter 渲染管线（build / layout / paint）
├── FjsEngine ──► libfjs ──► QuickJS runtime + context
└── Timer.periodic(16ms) ──► fjs_vm_pump()
```

- JS 没有自己的线程。`JS_Eval`、事件派发、微任务泵**全在 UI 线程上执行**。
- Dart→C++ 的回调用 `NativeCallable.isolateLocal`，按定义只能被拥有该
  isolate 的线程调用 —— 这条约束把"从别的线程回调 JS"直接堵死了。
- v1 每个进程一个 engine，VM 实例持有线程宿主单例（`HostBridge.install`）。

**代价**：一段长 JS 计算会卡帧，和在 Flutter 里写同步死循环一样。
把它挪到 Worker 是唯一解。

## 泵（pump）：JS 的异步是怎么推进的

QuickJS 自己不带事件循环。Dart 侧每 16ms（≈ 一帧）调一次
[`engine.dart:414`](../packages/flutter_fjs/lib/src/engine.dart) 的
`pump()`，它做两件事：

1. 执行到期的 timer（`setTimeout` / `setInterval`）
2. 排空 promise 微任务队列

单次 pump 有 **10000 次上限**，防止 `Promise.resolve().then` 自我调度的
微任务风暴把这一帧锁死。

```dart
Timer.periodic(const Duration(milliseconds: 16), (_) {
  if (!_disposed) pump();          // bind.pump(vm, bind.now(vm))
});
```

时间由引擎的单调时钟给（`fjs_vm_now`），不是 `Date.now()` —— 系统时间被改
不会让 timer 错乱。

## 一次点击的完整时序（全同步）

这是理解整个系统最重要的一张图。**从手指落下到界面更新，全部发生在
一次手势回调内，不跨线程、不过 JSON。**

```
① Flutter GestureDetector.onTap
        │  UI 线程
        ▼
② engine.dispatchEvent(nodeId, FJS_EVENT_TAP)        Dart
        │  dart:ffi（纯 C ABI）
        ▼
③ fjs_vm_dispatch_event(...)                          C++
        │  JS_Call(__fjsDispatchEvent, ...)  ← 同步调用 JS
        ▼
④ @ufjs/runtime 事件注册表找到 onTap 处理器并执行      JS
        │
⑤ 处理器调 setText(...) ──► op 写入帧缓冲
        │                   queueMicrotask(flush)
        ▼
⑥ dispatch 返回前 C++ 泵空微任务（fjs_vm_pump）
        │  flush() ──► __fjs.fns.uiOps(frame)  ← 同步回调 Dart
        ▼
⑦ Dart 把 op 应用到镜像树 ──► notifyListeners()        Dart
        │
        ▼
⑧ Flutter 本帧重建
```

关键在 ⑥：**微任务在 `dispatch_event` 返回之前就被泵空了**，所以 UI 更新
和这次手势在同一帧。如果等下一次 16ms 的周期泵，点击就会慢一帧。

### 为什么按压态（`:active`）不走这条链

按下高亮如果按上面这条链走一圈，即使全同步也要一帧。所以
`:active` 的样式在 CSS 引擎里**提前算好**，随 `activeStyle` 一起下发给
Dart；按下时由**节点自己**就地切换，根本不回 JS。见
[vue3.md](vue3.md#style--style-scoped) 和 [css-compat.md](css-compat.md)。

## fetch：异步宿主调用的范式

`invokeHost` 是同步的，但网络不能同步等。做法是把"发起"和"回结果"拆成
两条已有通道，**不新增任何 C ABI**：

```
JS                              Dart                              JS
fetch(url)
  └─ invokeHost('fjs.http.request', id, reqJson)   ← 同步返回，只是登记
                                  │  HttpClient 异步跑
                                  ▼
       dispatchEvent(id, 14 /* httpResponse */, resJson) ──► promise 落定
ctrl.abort()
  └─ invokeHost('fjs.http.abort', id)
```

`id` 由 JS 侧分配，Promise 存在 JS 侧的 pending 表里。**任何需要异步返回的
宿主模块都照这个形状写**（宪法 II）。实现在
[`lib/src/http.dart`](../packages/flutter_fjs/lib/src/http.dart) 和
[`net/fetch.ts`](../packages/fjs-runtime/src/net/fetch.ts)。

## Worker：真正的并行

`new Worker(code)` 在 Dart 侧 `Isolate.spawn` 一个新 isolate，里面起一个
**独立的 QuickJS runtime**，用 8ms 的 `Timer.periodic` 自己泵
（[`worker.dart:187`](../packages/flutter_fjs/lib/src/worker.dart)）。

```
UI isolate                          Worker isolate
FjsEngine / QuickJS #1   ◄── SendPort ──►   QuickJS #2
   16ms pump                                   8ms pump
```

- 两个 runtime **不共享任何 JS 对象**，通信只有 `postMessage` 的字符串。
- API 是 Web Worker 风格（`postMessage` / `onmessage` / `terminate`）。
- Web 目标上就是真的 Web Worker（Blob URL）。
- 长任务（大列表排序、解析）放这里，见
  [performance.md](performance.md#worker-加速) 和 `examples/bench`。

## 生命周期

```
FjsEngine()            → fjs_vm_create（runtime + context + natives 安装）
addPrelude(chunk)      → 共享块 eval；每次 reset 自动重放
runSource / runBundle  → eval → 泵微任务 → 首帧 UI ops 落到镜像树
startEventLoop         → 启动 16ms 周期泵
connectDev(host, port) → HTTP 拉 bundle；WS 收 reload → reset() 重建 VM
dispose                → fjs_vm_destroy
```

`reset()` 销毁整个 VM，全局对象随之消失。所以分包出来的共享 prelude 由
engine 在新 VM 里**重新 eval**，宿主不需要自己排序 —— 这是 dev 热重载能
只推变更 chunk 的前提，见 [code-splitting.md](code-splitting.md)。

## 现状与计划

| | 现在 | 计划 |
|---|---|---|
| 主线程 JS | UI isolate，同步 | 不变（这是设计目标）|
| 异步宿主调用 | fetch 范式手写 | `invokeHostAsync`（Promise 化）|
| 热重载 | 整个 VM reset | 模块级 HMR（需 bundle 保留模块边界）|
| 多 engine | 一进程一个 | — |

见 [roadmap.md](roadmap.md)。
