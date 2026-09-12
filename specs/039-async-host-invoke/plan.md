# Plan: 异步宿主调用 invokeHostAsync

对应 spec：`./spec.md`
待澄清裁决：示例模块取默认方案（hello-fjs 宿主里的一次性 fake 存储），
不做真实能力模块。

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 涉及 | JS 侧实现只有一份（`host-async.ts`），两端共用；web 无 Dart 宿主，reject 路径就是 web 的行为，作为**已知差异**登记进 `docs/jsi-and-native-modules.md`。示例页两端可跑：Flutter 走真通道，web 展示 reject 文案，页面代码一行不改 |
| II 边界即契约 | 涉及事件表 | 动的是**事件类型**这张表：`native/include/fjs.h` 加 `FJS_EVENT_ASYNC_RESULT = 32`，Dart 侧 `lib/src/ffi.dart` 的 `FjsEvent` 加 `asyncResult = 32`，JS 侧 `host-async.ts` 用 `registerSystemHandler(32)` 消费。op 协议与 natives 表**不动**（`invokeHost` 本来就是通用标量直通，事件 32 是系统事件，不进 `element.ts` 的 `EventType` 节点表——worker 9 / http 14 / canvas 30 同类） |
| III 同步单线程零序列化 | 涉及 | 发起是同步的（JSI host function 立即返回）；异步等待发生在 **Dart 事件循环**，不在 JS↔Dart 边界上；完成回调里 `dispatchEvent` 重入 VM，与 `http.dart` 同一条已验证路径。参数走一个 JSON 串是 v1 ABI 的既定豁免（对象 JSON 字符串化） |
| IV 外观照 WeUI | 不涉及 | 无 UI 组件 |
| V 静默失效是 bug | 涉及 | 未注册的 name **立即**回错误载荷；handler 抛异常回错误载荷；返回值不可 JSON 编码回错误载荷（不丢不悬）；无原生 host reject。唯一允许的静默丢弃：VM 重建后迟到 dispatch 查无此 id（fetch 同款，`pending.delete` 先例） |
| VI 注释记录权衡 | 涉及 | `host-async.ts` 顶部注释写「为什么复用 invokeHost+dispatchEvent 而不是新开 C ABI」；Dart 侧写「为什么 registerAsync 与 register 分表」 |
| VII JS 能包就不要下 Dart | 不适用 | 宿主模块本来就定义在 Dart 侧（native capability），没有「包成 JS 组件」的问题；JS 侧新增的只是通道封装 |
| VIII 变更落到文档 | 涉及 | `docs/jsi-and-native-modules.md`（新章节：API、时序、载荷形状、web 差异）、`docs/modules.md`（模块作者的 registerAsync 指引）、`docs/roadmap.md`（近期计划打勾） |

无破例。

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| JS runtime | `packages/fjs-runtime/src/host-async.ts` | **新增**：`invokeHostAsync` + pending 表 + `registerSystemHandler(32)` 分发器 |
| JS runtime | `packages/fjs-runtime/src/index.ts` | 导出 `invokeHostAsync`（挨着 `invokeHost`） |
| JS runtime 测试 | `packages/fjs-runtime/test/host-async.test.ts` | **新增**：mock `__fjs`（`fetch.test.ts` 手法），断言发起参数形状、并发 id 正确 settle、errMsg reject、无 host reject |
| C++ | `packages/flutter_fjs/native/include/fjs.h` | `FJS_EVENT_ASYNC_RESULT = 32`（下一个空闲号，注释写载荷形状） |
| Dart 宿主 | `packages/flutter_fjs/lib/src/ffi.dart` | `FjsEvent.asyncResult = 32` |
| Dart 宿主 | `packages/flutter_fjs/lib/src/registry/host.dart` | `registerAsync` / `unregisterAsync` + `_asyncHandlers` 查找；与同步表分开 |
| Dart 宿主 | `packages/flutter_fjs/lib/src/engine.dart` | 内置 `'fjs.async.invoke'` handler（挨着 `fjs.http.request` 注册）：查 async 表 → `handler(jsonDecode(argsJson))` → then/catchError → `dispatchEvent(id, asyncResult, jsonEncode({ok,…}))` |
| Dart 测试 | `packages/flutter_fjs/test/host_async_test.dart` | **新增**：端到端（发起 → Future 完成 → 载荷可解码、字段序）；未注册名立即错误载荷；返回值不可编码 → 错误载荷 |
| 示例宿主 | `examples/hello-fjs/.fjs/flutter/lib/main.dart` | demo 模块 `demo.asyncStore`：`registerAsync`，延时 1.5s 返回 fake 存储读写结果（挨着现有同步 `device` 模块） |
| 示例页面 | `examples/hello-fjs/src/pages/example/async-host.vue` | **新增**：两个按钮（write / read），`await invokeHostAsync` 展示结果与耗时；`hasNativeHost` 为 false 时展示 reject 文案（web 路径可见） |
| 文档 | `docs/jsi-and-native-modules.md` | 「JS → Dart：异步宿主调用」章节（时序图 + 载荷形状 + web 差异 + 与 fetch 通道的关系） |
| 文档 | `docs/modules.md` | 模块作者侧：`engine.host.registerAsync` 用法、参数/返回值的 JSON 约定 |
| 文档 | `docs/roadmap.md` | 近期计划「异步宿主调用」打勾，落成小节 |

CLI / 构建、Web 适配层（`src/web/`）、fjsc：**不涉及**。

## 3. 方案

**选定**：fetch 范式的通用化。

```
JS    invokeHostAsync('user.profile', 42, 'full')
  → sync invokeHost('fjs.async.invoke', callId, name, JSON.stringify([42,'full']))
      ↑ 立即返回；pending.set(callId, {resolve, reject})
Dart  engine 内置 handler：
      handler = registry.asyncHandler(name)  // 没有 → 立即 dispatch 错误载荷
      handler(jsonDecode(argsJson) as List<Object?>)
        .then((v)  => dispatch(id, 32, jsonEncode({'ok':true,  'value':v})))
        .catchError((e) => dispatch(id, 32, jsonEncode({'ok':false,'errMsg':'$e'})))
JS    registerSystemHandler(32): pending 按 callId settle
      ok    → resolve(json['value'])            // value 缺省 → undefined
      !ok   → reject(new Error(json['errMsg']))
```

关键决策：

- **参数整体一个 JSON 数组串**，而不是逐个标量透传：Dart handler 收到的
  `List<Object?>` 语义单一（解码后的 JSON 值），不会出现「分不清这串
  string 是用户字符串还是 JSON 化的对象」的歧义；标量零损耗
  （JSON 编解码 scalar 无信息损失）。
- **`registerAsync` 与 `register` 分两张表**：`HostResult invoke` 是同步
  契约（trampoline 当场返回），async handler 返回 `Future`，混一张表会让
  每个同步调用付一次 `is Future` 检查，且同名注册两种形态是bug。
- **未注册立即错误载荷**在 Dart handler 里做（不是 JS 侧预查）：JS 侧
  没有也不该有宿主模块清单，这是通道本身的职责。
- 返回值 `jsonEncode` 失败（不可编码对象）在 `catchError` 之外单独兜一层，
  回 `errMsg: 'return value is not JSON-encodable'`——静默丢结果是宪法 V。

**被否掉的备选**：

1. **新开 C ABI `fjs_invoke_host_async`**（natives.cpp + native-global.d.ts
   + ABI 版本管理）——宪法 II 明说不为新功能开 C ABI；`invokeHost` 是通用
   标量直通，新 ABI 不带来任何它给不了的东西。零收益、三张表陪葬。
2. **`HostRegistry.invoke` 允许返回 Future，引擎代为 await**——同上，
   同步契约被污染，见分表决策。
3. **复用事件 14（httpResponse）加 `t` 判别**——canvas 事件 30 用判别载荷
   是因为 image/dataURL 同源；async 调用与 HTTP 毫无关系，判别字段是永久税。
   事件号便宜（int），fetch 当年也是单开 14。
4. **web 侧做一层 JS 异步注册表**——spec §4 已否：会造出第二个 substrate，
   模块的 web 实现走浏览器 API 是既定模式（`@ufjs/webview`）。

## 4. 风险

- **dispatch 重入时机**：async handler 完成回调里 `dispatchEvent` 同步重入
  QuickJS。若 handler 是已完成的 Future，`.then` 在微任务里触发，此时
  `invokeHost` 已返回、JS 栈已空——安全；http.dart 同路径多年验证。
  但**不要**在 handler 同步执行体里直接 dispatch（此刻 JS 还在
  invokeHost 里）——实现时用 `.then` 保证永远走事件循环。
- **VM 重建后的迟到 dispatch**（reload / units 重挂）：JS pending 表随 VM
  死掉或 id 对不上，dispatch 查无此 id 丢弃。无害，但要在 `host-async.ts`
  注释里写明这是唯一允许的静默路径。
- **两端对拍点**：示例页 Flutter 端看真实异步返回；web 端确认 reject 文案
  出现且页面不白屏。字段序（`{"ok":…}` 在前）靠 Dart 测试断言。
- **`fjs dev` HMR**：units 重挂不重建 VM，pending 表存活，Promise 照常
  settle——无需处理，但示例页别在模块顶层 await。

## 5. 验证路径

```bash
# JS 侧
pnpm run typecheck
pnpm test                                  # 含新增 host-async.test.ts

# Dart 侧（先编 native，否则整文件静默跳过——AGENTS.md §3 的坑）
cd packages/flutter_fjs/native
cmake --build build-native -j
cd .. && flutter test test/host_async_test.dart

# 示例两端
pnpm --filter hello-fjs run dev            # 或 fjs dev，连 fjs-go / 自建宿主
cd examples/hello-fjs && fjs dev --web     # web 端看 reject 路径
```
