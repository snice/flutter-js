# Tasks: 结构化对象跨越 JSI（HostObject 句柄）

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 C 契约：`packages/flutter_fjs/native/include/fjs.h` 声明
      `fjs_handle_put_bytes` / `fjs_handle_bytes` / `fjs_handle_release`，
      `FJS_ABI_VERSION` 1→2；`packages/flutter_fjs/lib/src/ffi.dart` bind
      表同步（三函数 + FjsBindings 方法）
- [x] T002 natives 表契约：`packages/flutter_fjs/native/src/natives.cpp`
      的 `__fjs.fns` 新增 `handleBytes` / `readHandleBytes` / `releaseHandle`，
      `packages/fjs-runtime/src/native-global.d.ts` 同步签名

## 实现

- [x] T010 C++ 字节表：`FJSVM` 增加 map、id 单调自增、三个 C 函数实现、
      `fjs_vm_destroy` 清算（vm.cpp 或新 handle_bytes.cpp，fjs_internal.h
      声明）
- [x] T020 fjs-test：句柄 put/read 往返、release 后读返回 null、VM destroy
      清算、stale id 报错（native/test）
- [x] T030 Dart http.dart：响应 bytes → putHandleBytes、payload 以
      `handle` 替代 `bodyBase64`；请求 `bodyHandle` → 拷出 → 发送 →
      release；错误路径与 abort 不受影响
- [x] T031 fetch.ts：响应句柄惰性持有 + `arrayBuffer()` 单消费语义 +
      text/json/blob 收敛；`encodeBody` 优先 `handleBytes`、旧宿主退回
      base64；abiVersion < 2 时 warn
- [x] T032 fjs-runtime vitest：fetch 响应（handle 路径 / 旧 base64 路径 /
      空体 / 错误）、请求（typedArray / 字符串 / 旧宿主退回）、二次 body
      读取报错、stale 句柄报错

## 两端对齐

- [x] T040 `fjsrun` 冒烟：dist bundle 的 fetch（JSON + 二进制）离线可跑
- [x] T041 模拟器（`fjs run ios`）fetch 冒烟：JSON / 文本 / 二进制图片 /
      POST 二进制体 / abort，两端页面行为一致（web 由既有原生通道覆盖）

## 测试与对照

- [x] T050 `pnpm run typecheck`、`pnpm test`、`flutter analyze`、
      `cmake --build build-native` + `fjs-test` 全绿
- [x] T051 性能对照（Dart 侧通道成本，`test/handle_bench_test.dart`，
      M 系列宿主机）：1MB 旧 7053µs → 新 505µs（**14×**）；
      5MB 旧 27748µs → 新 864µs（**32×**）。数字已落 docs/performance.md
      与 docs/jsi-and-native-modules.md。真机（iPhone 17 Pro 模拟器）
      端到端：637KB 体 fetch 10.8ms、arrayBuffer 读出 0.1ms、
      POST 二进制体（64B）上行走通——临时探测页验完已还原

## 文档

- [x] T060 `docs/principles.md` 决策二改写（number 句柄 + C++ 字节表的
      架构理由）；`docs/jsi-and-native-modules.md` 新机制一节 + 未消费
      句柄登记；`docs/performance.md` 对照数字
- [x] T061 `docs/roadmap.md`：近期计划划掉本项并附 spec 链接；措辞从
      「JS_GetOpaque 持 C++ 指针」更正为落成的形态

## 验收

- [x] T070 spec.md 第 6 节逐条核对，结果记在本条
      —— 1 native fjs-test（句柄往返/释放/VM 清算/stale id）+
      vitest 362 项（fetch 双路径 5 项新增）全绿；2 typecheck 6 包 +
      flutter analyze 无新问题；3 fetch 行为回归：vitest 全量 +
      flutter test 283 项（http_engine_test 改造为句柄契约 + POST 上行
      用例）；4 性能对照见 T051（14×/32×）；5 生命周期：fjs-test 覆盖
      「VM destroy 后旧 id miss」与「release 后读取抛错」；6 fjsrun
      冒烟（UI 帧正常）+ 模拟器探测页（三种请求）通过
