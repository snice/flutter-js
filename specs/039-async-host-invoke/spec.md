# Spec: 异步宿主调用 invokeHostAsync

- **ID**: 039-async-host-invoke
- **状态**: done（实机对拍待用户跑：App 端真通道 + web 端 reject 文案，
  自动化侧已由 vitest 与 Dart 测试覆盖）
- **日期**: 2026-09-12

## 1. 要解决什么

Dart 宿主模块目前只能**同步**应答：`HostRegistry.invoke` 在 JSI 回调
（`HostBridge._invokeHostTrampoline`）里当场算出结果返回。凡是需要等
Dart 事件循环的能力——读写插件（SharedPreferences / 路径 / 剪贴板）、
权限申请、任何 `Future` 结尾的三方 SDK——都没法做成宿主模块，
模块作者只能绕道：要么复用 fetch 那条专用通道（`fjs.http.request`，
语义绑死在 HTTP 上），要么把 Future 的结果憋成轮询。

宪法 II 指了路：「不要为一个功能新开 C ABI，先看 fetch 那个范式能不能用」。
本 spec 把 fetch 范式从 HTTP 专用的形态提炼成**通用的异步宿主调用**，
roadmap「近期计划」第一条。

## 2. 不做什么（Non-goals）

- **不做取消**。fetch 有 AbortController 是因为 HTTP 有明确的中止语义；
  宿主调用没有——Dart handler 想支持取消，在参数里自己带一个一次性
  cancel 名字即可。Promise 不提供 reject 入口。
- **不做超时**。同上，超时策略属于各模块自己。
- **不做结构化对象直传**。v1 ABI 只过标量（宪法 II），参数与返回值都走
  JSON 字符串，通用对象的结构化传递已顺延到中期（见 roadmap spec 038 段）。
- **不新增 `__fjs.fns` 原生函数、不改 natives.cpp / native-global.d.ts /
  op 协议**。通道全部复用既有的 `invokeHost`（同步发起）与
  `dispatchEvent`（异步回结果），见下。
- **不动 Worker / fetch 现有实现**。fetch 继续用自己的 pending 表和事件 14。

## 3. 用户可见的行为

### 3.1 JS 侧（页面与模块作者）

```ts
import { invokeHostAsync, hasNativeHost } from 'fjs';

// 参数：标量原样，非标量整体 JSON 编码（见 §4）
const user = await invokeHostAsync<{ name: string }>('user.profile', 42, 'full');

try {
  await invokeHostAsync('storage.set', 'key', 'value');
} catch (e) {
  // reject 的 Error.message 是 Dart 侧给的 errMsg
}
```

- 无原生 host（web、fjsrun）时 reject：`invokeHostAsync: no native host …`，
  与 `invokeHost` 同步抛错的行为对齐，**不静默**（宪法 V）。
- 模块在 web 端有异步能力时，模块自己的 JS 实现走浏览器 API
  （`@ufjs/webview` 的先例），不经过这条通道。

### 3.2 Dart 侧（宿主模块作者）

```dart
// engine.host 现有 register(name, (args) => Object?) 旁新增：
engine.host.registerAsync('user.profile', (args) async {
  // args: List<Object?> —— invokeHostAsync 的参数数组经 JSON 解码后的值
  final user = await userRepository.load(args[0] as int);
  return user; // 必须 JSON 可编码；返回值 jsonEncode 后下发
});
```

- 未注册的 name **立即**回 `{ok:false,errMsg}` 而不是让 Promise 悬死
  （宪法 V：静默失效是 bug）。
- handler 抛异常同样回错误载荷，不崩引擎。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| API | `invokeHostAsync(name, ...args): Promise<T>`，从 `fjs` 导出 | 同名导出，无原生 host 时 **reject**（登记差异） |
| 参数 | 标量原样过；整体作为**一个 JSON 数组串**交给 Dart，handler 收到解码后的 `List<Object?>` | — |
| 返回 | Dart handler 的返回值 `jsonEncode` 进载荷 | — |
| 已知差异 | — | 异步能力在 web 由模块自己的 JS 实现提供（浏览器 API），运行时不提供假的 host；与 `invokeHost` 在 web 上抛错同一条边界 |

做不到两端一致的原因：web 端没有 Dart 宿主，「宿主模块」这个概念本身
不成立（fetch 在 web 换浏览器实现是同一个道理）；强行做一层 JS 侧异步
注册表只会造出第二个 substrate。

## 5. 协议与通道

JS ↔ Dart 时序（fetch 同款，宪法 II/III）：

```
JS    invokeHostAsync('user.profile', 42)
  → sync invokeHost('fjs.async.invoke', callId, name, argsJson)   // 立即返回
Dart  引擎内置 handler：查 async 表 → handler(jsonDecode(argsJson))
  → 完成后 dispatchEvent(callId, FJS_EVENT_ASYNC_RESULT, '{"ok":true,"value":…}')
JS    registerSystemHandler(32) 的 pending 表按 callId resolve / reject
```

- **载荷字段序固定**：成功 `{"ok":true,"value":<JSON>}`，失败
  `{"ok":false,"errMsg":"…"}`（`value` 缺省不发）。两端（若 web 端出现
  模拟实现）与文档以这个序为准。
- `callId` 由 JS 侧分配、单调递增；VM 重建（reload）后 JS pending 表自然
  清空，迟到的 dispatch 查无此 id 直接丢弃（fetch 的 `pending.delete` 同款）。
- Dart 侧不允许 JS↔Dart 跨线程：async handler 跑在 UI isolate 的事件循环上，
  完成回调里直接 `dispatchEvent`（`http.dart` 已验证的路径）。

## 6. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）——**不涉及**
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）——**不涉及**
- [x] 事件类型：`fjs.h` 增 `FJS_EVENT_ASYNC_RESULT = 32`（下一个空闲号）；
  Dart 侧 `ffi.dart` 的 `FjsEvent` 增 `asyncResult = 32`；JS 侧走
  `registerSystemHandler(32)`（worker 9 / http 14 / canvas 30 同类，
  **不进** `EventType` 表——它不挂在节点上）
- [x] Dart 公开 API：`HostRegistry` 增 `registerAsync` / 对应 unregister

## 7. 验收标准

1. `pnpm typecheck` 与 `pnpm test` 通过；新增
   `packages/fjs-runtime/src/host-async.ts`（名字以 plan 为准）的单测：
   mock `__fjs` 后并发 3 个调用按各自 callId 正确 settle、errMsg 走 reject、
   无 host 时 reject（fetch 测试的同款手法）。
2. `packages/flutter_fjs` 新增 Dart 测试：注册 `registerAsync` 模块 →
   invokeHost 发起 → Future 完成后 dispatchEvent 载荷可解码、字段序符合 §5；
   未注册 name 立即收到错误载荷。
3. `examples/hello-fjs` 增加一个「异步宿主调用」示例页：宿主注册一个
   `registerAsync` 演示模块（如 1.5s 后返回值的 fake 存储），页面
   `await invokeHostAsync` 展示结果；`fjs dev --web` 上页面正常渲染并
   展示 reject 路径（两端可观察、行为可对照）。
   实现注记：模块写在 hello-fjs 的 managed 宿主
   `.fjs/flutter/lib/main.dart`（git 忽略）。managed 宿主的 `main.dart`
   每次 `fjs run` 都会重新生成，模块要按 §3.2 的形状贴回去——完整片段
   存本目录 [demo-module.dart](demo-module.dart)，页面本身不依赖它也能
   跑（未注册时走 reject 路径，正好演示另一条边）。
4. `./build-native/fjsrun dist/bundle.js` 上示例页在无 host 时明确报错，
   不静默、不悬挂。
5. 文档落地（宪法 VIII）：`docs/jsi-and-native-modules.md` 增
   invokeHostAsync 章节（时序图 + 载荷形状）、`docs/modules.md` 增
   `registerAsync` 的模块作者指引、`docs/roadmap.md` 打勾。

## 8. 待澄清

- [ ] 示例模块选型：演示模块做成 hello-fjs 宿主里的一次性 fake 存储，
      还是顺手挑一个真实能力（如剪贴板 `clipboard`）做成 `fjs-runtime`
      层的标准模块？后者更像「能力」、有复用价值，但会把范围从「通道」
      扩到「第一个真模块」。默认取前者（范围最小），如需后者请在 /plan
      前指出。
