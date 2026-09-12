# Tasks: 异步宿主调用 invokeHostAsync

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 `native/include/fjs.h` 加 `FJS_EVENT_ASYNC_RESULT = 32`（注释写载荷形状）
- [x] T002 `lib/src/ffi.dart` 的 `FjsEvent` 加 `asyncResult = 32`
- [x] T003 `lib/src/registry/host.dart` 加 `registerAsync` / `unregisterAsync` + async 表

## 实现

- [x] T010 `lib/src/engine.dart` 注册内置 `'fjs.async.invoke'` handler（`.then` 走事件循环；未注册 / 抛异常 / 不可编码回错误载荷）
- [x] T011 `packages/fjs-runtime/src/host-async.ts`：`invokeHostAsync` + pending 表 + `registerSystemHandler(32)`
- [x] T012 `packages/fjs-runtime/src/index.ts` 导出 `invokeHostAsync`

## 测试

- [x] T020 `packages/fjs-runtime/test/host-async.test.ts`（fetch.test.ts 手法：发起参数形状、并发按 id settle、errMsg reject、无 host reject）
- [x] T021 `packages/flutter_fjs/test/host_async_test.dart`（端到端、字段序、未注册名立即错误载荷、不可编码返回值）

## 示例与文档

- [x] T030 `examples/hello-fjs/.fjs/flutter/lib/main.dart` 加 `demo.asyncStore` 模块
- [x] T031 `examples/hello-fjs/src/pages/example/async-host.vue` 示例页（两端可跑）
- [x] T032 `docs/jsi-and-native-modules.md` 新章节（API / 时序 / 载荷 / web 差异）
- [x] T033 `docs/modules.md` registerAsync 指引
- [x] T034 `docs/roadmap.md` 近期计划打勾

## 验收

- [x] T040 `pnpm run typecheck`
- [x] T041 `pnpm test`
- [x] T042 `flutter test test/host_async_test.dart`（先编 native）
- [x] T043 spec.md §7 逐条核对
