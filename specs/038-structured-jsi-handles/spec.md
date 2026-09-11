# Spec: 结构化对象跨越 JSI（HostObject 句柄）

- **ID**: 038-structured-jsi-handles
- **状态**: done
- **日期**: 2026-09-12

## 1. 要解决什么

v1 ABI 只过标量（宪法 II），对象以 JSON 字符串、二进制以 base64 跨越
invokeHost 与事件通道。三个实际在流血的地方：

1. **fetch 响应体**：Dart `base64Encode`（×1.33）→ `jsonEncode` 转义
   （http.dart:223,248）→ JS `JSON.parse` + `base64Decode`（fetch.ts:259,269）。
   图片/二进制大响应是单项最大的序列化成本；请求体上行对称地再付一遍。
2. **`fjs eval` / 高频小对象**：measureText 的字体对象（同步、图表布局
   热路径、靠 2048 条 LRU 缓存兜底）、webgl 26 个同步查询的 JSON 返回
   （着色器编译期高频）——小，但每一次都在给 GC 添分配
   （performance.md：JSON.stringify ≈ 2µs/对象，GC 主导设备数字）。
3. **架构事实**：宿主模块执行体全在 Dart，C++ 层只是转换器
   （`js_invoke_host` → FFI 回调 → Dart）。所以「纯 QuickJS↔C++ 的
   HostObject」帮不到现有消费者；真正省序列化的是**不透明数据引用**：
   大块数据留在宿主侧（Dart 持有），JS 持句柄（标量！），按需拷贝。

roadmap 原文：「HostObject 句柄（JS_GetOpaque 持 C++ 指针），避免对象以
字符串形式跨越 invokeHost」。本 spec 把它落成机制 + 第一个标杆消费者。

## 2. 不做什么（Non-goals）

- **不动的通道**：UI op 帧已经是二进制协议；canvas display list 明确拒绝
  JSON；touch/scroll 的事件载荷 JSON 是另一项工作（dispatchEvent 加结构化
  参数，见 plan 风险节），本 spec 不碰 dispatchEvent。
- **不迁全部消费者**：measureText 字体（更该拆标量）、webgl 查询（小且
  需要的是返回对象不是句柄）、Worker postMessage（结构化克隆是独立项）——
  均不在本期，各自顺延。
- **不做通用结构化克隆**：不承诺任意 JS 对象双向透明；句柄是**不透明**
  引用，字段访问不跨界（要么整体读出、要么数据留在宿主侧被消费）。
- **不引入跨线程**：宪法 III 不变，全部同步、UI isolate 上。
- **不动 fjs-go**（走同一 engine 路径，自动获得）。

## 3. 用户可见的行为

页面代码**一行不改**，两端不变；变化全部在 dev/release 的运行成本：

```ts
// fetch 照常写——响应体不再走 base64+JSON 双重编码
const res = await fetch('/big-image.png');
const buf = await res.arrayBuffer(); // 宿主侧字节按需一次拷贝，无 base64
const res2 = await fetch('/api', { method: 'POST', body: uint8 }); // 上行同理
```

机制层（面向模块作者）：

- 宿主模块（Dart 侧）可以创建**句柄**：把任意 Dart 对象存进引擎的
  句柄表，得到一个 int id；这个 id 作为普通标量跨 invokeHost / 事件通道，
  在 JS 侧是一个不透明包装对象（或直接是 number——见待澄清）。
- JS 侧把句柄传回任何宿主模块，宿主凭 id 查表拿回对象——数据零序列化。
- 句柄有明确生命周期：显式释放或 VM 销毁时清算，不泄漏不悬挂。

## 4. 两端约定（宪法 I）

机制层在 native/FFI，web 侧**没有也不需要**对应物（浏览器本来就是结构化
世界）。契约对齐面是「JS 代码一行不改两端跑」：fetch 行为两端一致，App 端
只是内部换通道。

| | App | Web |
|---|---|---|
| fetch 语义 | 响应/请求体经句柄通道，arrayBuffer 按需拷贝 | 浏览器原生，不变 |
| 已知差异 | 无用户可见差异；性能特征更好 | 登记进 docs/web.md「已知差异」不需新增条目 |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）——不涉及
- [x] natives 表（`native-global.d.ts` + `natives.cpp`）：`__fjs.fns` 新增
      `handleBytes` / `readHandleBytes` / `releaseHandle` 三个方法（二进制
      句柄的建/读/释）；句柄本体是 number，走既有标量通道，FJSValue 不加
      tag。`fjs.h` 新增 Dart→native 的字节写入/读出 C 函数，
      **FJS_ABI_VERSION 1 → 2**，`ffi.dart` 的 bind 表同步
- [ ] 事件类型（`element.ts` + `fjs.h`）——不新增事件号；事件 14（fetch
      响应）的载荷形状变化（bodyBase64 移出、改携 handle）属于该事件的
      契约修订，JS 侧 `net/fetch.ts` 与 Dart 侧 `http.dart` 同步改

## 6. 验收标准

1. 单元测试：native 侧句柄 class 的创建/读取/finalizer（fjs-test 可执行
   文件覆盖：句柄存活期读取、JS 丢弃后 finalizer 释放、VM destroy 清算）；
   `pnpm test`（fetch 通道行为回归）全绿。
2. `pnpm run typecheck` 全 workspace；`flutter analyze` 无新问题。
3. fetch 行为回归：demo / hello-fjs 现有 fetch 用例（JSON、文本、二进制
   图片、错误路径、abort）两端表现不变。
4. 性能对照：examples/bench 或一次性脚本，大响应（≥1MB）`arrayBuffer()`
   的端到端耗时与 GC 分配对比改动前后，数值记在 tasks。
5. 生命周期验证：VM reset（dev 全量 reload）后旧句柄全部清算（Dart 侧
   表空），旧句柄 id 在新 VM 使用时得到**显式报错**而不是静默错数据。
6. `fjsrun dist/bundle.js` 与真机/模拟器各跑一次 fetch 冒烟。

## 7. 待澄清

已拍板（2026-09-12）：

- [x] 范围 = **机制层 + fetch 二进制体双向句柄化**——机制落地即有真实
      收益（fetch 是当前最大的序列化成本）。
- [x] 句柄在 JS 侧的形状 = **number**。推论：roadmap 原文的
      「JS_GetOpaque 持 C++ 指针」路线不采用——宿主模块执行体全在 Dart，
      C++ 指针 Dart 拿不到；真正省序列化的形态是 **number 句柄 + C++ 侧
      字节表**（数据过 Dart→C++ 一次，之后 JS↔宿主全走标量 id）。
      roadmap 措辞随本 spec 更新。
