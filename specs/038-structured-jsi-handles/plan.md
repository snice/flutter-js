# Plan: 结构化对象跨越 JSI（HostObject 句柄）

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是（fetch 语义） | 页面代码一行不改两端跑；web 侧 fetch 走浏览器原生（本来就是结构化世界），只有 App 内部换通道；无新增用户可见差异，docs/web.md 不需新增条目 |
| II 边界即契约 | 是 | natives 表：`native-global.d.ts` ↔ `natives.cpp`（fns 新增 handleBytes / readHandleBytes / releaseHandle）；C 契约：`fjs.h`（新 bind 函数声明 + ABI 2）↔ `ffi.dart`（bind 表）；事件 14 载荷：`fetch.ts` ↔ `http.dart` 同步改。FJSValue 不加 tag——句柄是 number，走既有标量通道 |
| III 同步单线程零序列化 | 是 | 句柄表在 C++（FJSVM 成员），全部调用同步、UI isolate；数据 Dart→C++ 拷一次后不再跨界序列化，JS 读时 C++→JS 一次 memcpy |
| IV 外观照 WeUI | 否 | 不涉及 UI |
| V 静默失效是 bug | 是 | stale/未知句柄读取返回 null 并 `warnOnce`，宿主模块报错；旧 runtime 配新宿主（不支持矩阵）时 fetch 启动即 warn 并显式报 body 缺失，不静默空体 |
| VI 注释记录权衡 | 是 | number 句柄 + C++ 字节表（而非 roadmap 原文的 JS_GetOpaque）的架构理由写进 value/句柄实现顶部与 principles.md；单消费释放语义写进 fetch.ts |
| VII JS 能包就不要下 Dart | 是 | 本机制全部落在 native/Dart 既有边界内，JS 侧只有 fetch.ts 的通道选择；没有新增渲染职责 |
| VIII 变更落到文档 | 是 | principles.md（决策二改写）、jsi-and-native-modules.md（v1 ABI 论述 + 新机制一节）、roadmap.md（措辞更新 + 打勾）、performance.md（对照数字） |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| C++ 引擎 | `packages/flutter_fjs/native/include/fjs.h` | `FJS_ABI_VERSION` 1→2；新增三个 C 函数声明：`fjs_handle_put_bytes`（Dart 写入）、`fjs_handle_bytes`（Dart 借读）、`fjs_handle_release` |
| C++ 引擎 | `packages/flutter_fjs/native/src/vm.cpp`（或新 `handle_bytes.cpp` + `fjs_internal.h` 声明） | `FJSVM` 增加字节表 `std::unordered_map<int64_t, std::vector<uint8_t>>`；id 单调自增**不随 reset 归零**（旧 id 永不 alias 新数据）；`fjs_vm_destroy` 清表 |
| C++ 引擎 | `packages/flutter_fjs/native/src/natives.cpp` | `__fjs.fns` 新增 `handleBytes(typedArray|ArrayBuffer) -> int`、`readHandleBytes(id) -> Uint8Array|null`、`releaseHandle(id)`；native/test 的 fjs-test 补用例（put/read/release、destroy 清算、stale id） |
| Dart FFI | `packages/flutter_fjs/lib/src/ffi.dart` | bind 表加三个函数指针；`FjsBindings` 暴露对应方法 |
| Dart 宿主 | `packages/flutter_fjs/lib/src/http.dart` | 响应：`_send` 把 bytes `putHandleBytes` 进表，payload 以 `handle` 替代 `bodyBase64`（空体不建句柄）；请求：`spec['bodyHandle']` → `handle_bytes` 拷出 → 发送 → release；错误路径（非 ok 响应）不变 |
| JS runtime | `packages/fjs-runtime/src/native-global.d.ts` | `FjsNativeFns` 增加三个方法签名 |
| JS runtime | `packages/fjs-runtime/src/net/fetch.ts` | 响应：`wire.handle` 存在 → `FjsResponse` 惰性持句柄，`arrayBuffer()` 经 `readHandleBytes` 同步拷出、**消费后即 `releaseHandle`**（单消费），text/json/blob 复用；`abiVersion < 2` 或函数缺失 → warn + 明确报错（新宿主不发 bodyBase64，旧 runtime 不可用）。请求：`encodeBody` 优先 `handleBytes`（Uint8Array/ArrayBuffer/字符串 utf8 统一入表），函数缺失退回 base64（旧宿主兼容） |
| 文档 | `docs/principles.md`、`docs/jsi-and-native-modules.md`、`docs/roadmap.md`、`docs/performance.md` | 宪法 VIII 清单 |

fjs-go / web 适配层 / op 协议：零改动。

## 3. 方案

### 3.1 机制：number 句柄 + C++ 字节表

宿主模块执行体全在 Dart（`js_invoke_host` 经 FFI 回调进 Dart），C++ 指针
Dart 拿不到——所以 roadmap 原文的「JS_GetOpaque 持 C++ 指针」帮不到任何
现有消费者。落成的事实形态：

```
Dart (http.dart)                C++ (FJSVM.handles)            JS (fetch.ts)
  bytes ──putHandleBytes(id)──▶ map[id] = bytes
                                 ◀── handleBytes(u8) ────────  u8 = 响应/请求体
  bytes ◀──handle_bytes(id)────   ──readHandleBytes(id)──────▶ new Uint8Array(copy)
                                  ◀──releaseHandle(id) ───────  消费完即释放
```

- 数据**不进 Dart 表**：响应体到达后 Dart 只负责把字节塞进 C++（一次
  拷贝，替代旧的 base64+jsonEncode），之后 Dart 不再持有。
- 句柄 id 全程是 number，走既有 invokeHost / 事件载荷通道；**FJSValue 与
  事件协议的形状不变**。
- id 单调自增、VM destroy 时随 FJSVM 一起消失——旧 VM 的 id 在新 VM 查表
  必然 miss → 显式报错（`FjsCanvasImages.instance.clear()` 的坑不再重演）。

### 3.2 fetch 双向通道

- **响应**：`http.dart _send` 去掉 `base64Encode`+payload 里的
  `bodyBase64`，改为 `putHandleBytes` 后在 payload 放 `handle`（空体
  null）。`fetch.ts` 的 `FjsResponse` 惰性持句柄，`arrayBuffer()` 首次
  调用时 `readHandleBytes` 同步拷出并立即 `releaseHandle`（单消费：
  二次 body 读取报错，与浏览器 Streams 语义一致且最省内存）；`text()`
  `json()` `blob()` 全部收敛到 arrayBuffer 路径。
- **请求**：`encodeBody` 把 ArrayBuffer/TypedArray/字符串（utf8 编码后）
  经 `handleBytes` 入表，描述符带 `bodyHandle`；`http.dart` 拷出发送后
  release。旧宿主（无 `fns.handleBytes`）自动退回 base64——现有行为。
- **兼容矩阵**：`fjs-runtime` 与 `flutter_fjs` 锁版本发布（doctor 咬合
  检查 + `engineInfo.abiVersion` 启动校验）。JS 侧 abiVersion < 2 →
  fetch 启动 warn；若真收到无 body 且无 handle 的 ok 响应 → 显式
  `FjsError` 提示升级 runtime，不静默空体。

### 3.3 被否掉的备选

- **JS_GetOpaque / JSClassDef 句柄对象**：roadmap 原文路线。Dart 拿不到
  C++ 指针，只能再建一层 id→对象表，白多一个 finalizer 机制；对现有
  Dart 执行体的模块零收益。否（roadmap 措辞更新）。
- **FJSValue 加 FJS_T_HANDLE tag**：句柄是 number，标量通道已覆盖；加
  tag 要动 FFI struct + Dart 镜像 + 全部转换点，无收益。否。
- **Dart 侧句柄表（HandleRegistry）**：数据在 Dart 表里，JS 消费仍要
  一次 Dart→JS 字节传递通道（还得新设计），而字节直接进 C++ 后消费路径
  是纯 C++→JS memcpy。否。
- **响应体流式化（ReadableStream）**：收益更大但要把 dispatchEvent 通道
  改成结构化/多帧，范围爆炸。顺延（登记 roadmap）。

## 4. 风险

- **未消费响应的句柄滞留**：C++ map 进程级持有，消费即释放 + VM destroy
  清算；未消费的泄漏量 = 响应体 × 未消费数。fetch 并发低，登记进
  jsi-and-native-modules.md；后续需要再加 LRU 或 60s 过期。
- **旧 runtime + 新宿主**：非支持矩阵（锁版本发布），但失败必须响亮——
  见 3.2 兼容矩阵。
- **拷贝次数盘点**：响应 2 次（Dart→C++、C++→JS），请求 2 次（JS→C++、
  C++→Dart）——旧路径均 ≥4 次且带 base64 膨胀。`readHandleBytes` 返回的
  Uint8Array 与 `new Uint8Array(buffer)` 的所有权要在实现里写清。
- **大响应峰值内存**：C++ 表持有全部未消费体；1MB×并发 10 = 10MB 量级，
  可接受，登记。
- **fjs-test / vitest / flutter test 三层测试**：native 侧用例要覆盖
  destroy 清算路径（`No tests ran` 是坑，宪法 V）。

## 5. 验证路径

```bash
cd packages/flutter_fjs/native
cmake -B build-native -DFJS_BUILD_TESTS=ON && cmake --build build-native -j
./build-native/fjs-test                      # 句柄用例
pnpm run typecheck && pnpm test              # fetch 双路径回归
cd packages/flutter_fjs && flutter analyze   # Dart 侧
cd examples/hello-fjs && pnpm exec fjs run ios   # 模拟器 fetch 冒烟
# 性能对照（tasks 里记数）：1MB / 5MB 响应 arrayBuffer() 端到端耗时
```
