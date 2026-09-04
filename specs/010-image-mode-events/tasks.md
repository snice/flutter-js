# Tasks: image mode 与加载事件

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 在 `packages/fjs-runtime/src/ui/element.ts` 登记 `onLoad` / `onError` 事件号 26/27，并确认事件 handler 仍只发送存在标记、回调只接收字符串。
- [x] T002 在 `packages/flutter_fjs/lib/src/ffi.dart` 增加 `FjsEvent.imageLoad` / `imageError` 常量，并写清固定 JSON payload。
- [x] T003 在 `packages/flutter_fjs/native/include/fjs.h` 增加 `FJS_EVENT_IMAGE_LOAD = 26` / `FJS_EVENT_IMAGE_ERROR = 27`，不改 C ABI。
- [x] T004 在 `packages/fjs-runtime/src/vue-global.d.ts` 扩展 `FjsImageProps`：`mode`、`lazyLoad`、`onLoad`、`onError`，并将事件载荷声明为字符串。
- [x] T005（`^3.4.1`，pubspec.lock 解析到 3.4.1；Dart 3.3 兼容）在 `packages/flutter_fjs/pubspec.yaml` 增加兼容 Dart 3.3 的 `cached_network_image` 3.4.x 依赖，运行 `flutter pub get` 并检查 `pubspec.lock` 的解析结果。

## 实现

- [x] T010 新增 `packages/fjs-runtime/src/image/mode.ts`，实现 14 个 mode 的合法值、`mode` 优先于 `fit` 的解析、统一 fit/alignment 语义和未知 mode 的 `warnOnce`。
- [x] T011 新增 `packages/fjs-runtime/src/image/events.ts`，实现 load/error 固定字段顺序的 JSON 编码和单次终态状态机。
- [x] T012 将 `packages/flutter_fjs/lib/src/widgets/image.dart` 改为有状态 image widget：HTTP(S) 使用 `CachedNetworkImageProvider`，asset 使用 `AssetImage`，空 src 不请求资源。
- [x] T013 在 `packages/flutter_fjs/lib/src/widgets/image.dart` 接入 ImageStream listener，派发固定 load/error payload，加入 src cycle、终态互斥和 dispose 清理。
- [x] T014 在 `packages/flutter_fjs/lib/src/render/image_mode.dart` 或等价纯 helper 中实现 Flutter 的 `BoxFit`、`Alignment`、widthFix/heightFix 映射，并覆盖旧 `fit` 兼容路径。
- [x] T015 在 `packages/flutter_fjs/lib/src/render/image_visibility.dart` 实现 image 可见性注册、注销、viewport/预加载范围判断和无 viewport fallback 告警。
- [x] T016 在 `packages/flutter_fjs/lib/src/widgets/scroll_view.dart` 与 `packages/flutter_fjs/lib/src/widgets/list_view.dart` 的滚动通知路径刷新 image visibility registry。
- [x] T017 在 `packages/flutter_fjs/lib/src/node/node_adapters.dart` 将 tree、node、style、dispatch 与 BuildContext 传入 image widget，并保持通用装饰与手势包装不变。

## 两端对齐

- [x] T020 在 `packages/fjs-runtime/src/web/components/basic.ts` 扩展 `FjsImage`：实现 14 mode、src cycle、`load/error` 单次事件、naturalWidth/naturalHeight 和 `asset://` 处理。
- [x] T021 在 `packages/fjs-runtime/src/web/components/basic.ts` 接入 IntersectionObserver lazy-load；不支持时 `warnOnce` 并立即加载，已启动请求不取消。
- [x] T022 在 `packages/fjs-runtime/src/web/base-css.ts` 移除 image 固定 cover 的冲突规则，补内容盒、object-position 和 widthFix/heightFix 所需的稳定布局规则。
- [x] T023 确认 `packages/fjs-runtime/src/web/style.ts`、`packages/fjs-runtime/src/vue/renderer.ts` 与 `packages/fjs/src/bundler/vue-plugin.ts` 不会吞掉 image 新 props/events；必要时补最小适配。
- [x] T024（实机对拍抓到三处：Dart 的 mode switch 漏了 `center` 会静静降级成 `scaleToFill`；web 的 `heightFix` 被 column flex 的 stretch 拉满父宽，和 Flutter 的 `高 × 比例` 对不上；两端的 lazy 预加载余量一个 240 一个 0。都已修并补回归用例）对拍 Flutter/Web：14 个 mode 的裁剪、留白和对齐；显式 mode 覆盖 fit；普通页面、scroll-view、list-view 的 lazy-load；有效/无效 src 的事件次数与 JSON payload 逐字符一致。

## 测试

- [x] T030 新增 `packages/fjs-runtime/test/image-mode.test.ts`，覆盖 14 个 mode、默认值、mode/fit 优先级和未知 mode 告警。
- [x] T031 新增 `packages/fjs-runtime/test/image-events.test.ts`，覆盖 load/error JSON 字段顺序、稳定错误文案、终态互斥、src cycle 和重复回调去重。
- [x] T032 扩展 Web 组件测试，覆盖 `packages/fjs-runtime/src/web/components/basic.ts` 的 load/error、src 切换、asset scheme、lazy observer 和 IntersectionObserver fallback。
- [x] T033 新增 `packages/flutter_fjs/test/image_test.dart`，覆盖 provider 选择、CachedNetworkImageProvider、14 mode、空 src、intrinsic 尺寸和 load/error 单次派发。
- [x] T034 在 `image_test.dart` 覆盖 src 切换丢弃旧 ImageStream 结果、dispose 后不派事件、缓存命中仍只派一次终态。
- [x] T035（覆盖 scroll-view 滚入预加载区、无 viewport 的 warnOnce 兜底；list-view 行销毁/重建只在 iOS 模拟器上手工验过，没有用例）在 `image_test.dart` 覆盖 lazy-load：普通页面首帧、scroll-view 滚动进入预加载区、list-view 行销毁/重建和无 viewport fallback。
- [x] T036 扩展 `examples/hello-fjs/src/pages/comp/image.vue`，提供可观察的成功/失败事件、模式切换和 lazy-load 测试入口。

## 文档

- [x] T040 更新 `docs/ui-api.md` 的 image 标签表、props、14 个 mode、lazy-load、load/error 载荷和单次事件语义。
- [x] T041 更新 `docs/web.md` 或 `docs/css-compat.md`，记录 Flutter `cached_network_image`、Web 浏览器缓存、IntersectionObserver 以及 fix 模式的已知差异。
- [x] T042 更新 `docs/roadmap.md`，登记 image mode、lazy-load、load/error 和网络缓存能力完成。
- [x] T043 在代码注释中记录 provider 只使用 `CachedNetworkImageProvider`、不引入 `visibility_detector`、以及 mode 覆盖 fit 的兼容权衡。

## 验收

- [x] T050 `pnpm run typecheck`
- [x] T051 `pnpm --filter hello-fjs run typecheck`
- [x] T052 `pnpm test`
- [x] T053 `cd packages/flutter_fjs && flutter test`（必须先确认 native 已编译；`No tests ran` 视为失败）
- [x] T054（`@load` `{"width":600,"height":400}`、无效 URL 只派一次 `@error`、14 个 mode 的 object-fit/position 逐条核对、lazy 图片滚入前无 src）`pnpm --filter hello-fjs run dev:web`，逐条执行 spec 第 6 节中的 Web 操作验收
- [x] T055（远程图走 cached_network_image 正常出图；`@load` / `@error` 载荷与 web 逐字符相同；mode 裁剪与 web 一致；lazy 图片滚入内层 scroll-view 才加载。**Android 未测**）`pnpm --filter hello-fjs run run:ios`，逐条执行 spec 第 6 节中的 iOS 操作验收
- [x] T056（见下方「验收记录」）逐条核对 `spec.md` 第 6 节，记录依赖、native、Web/iOS 手工验证结果及任何已登记差异

## 验收记录

- `pnpm run typecheck` / `pnpm --filter hello-fjs run typecheck`：通过。
- `pnpm test`：27 + 5 个文件，196 + 56 条全过。
- `flutter analyze`：2 条既有 info（`render/decoration.dart` 与
  `test/dev_client_test.dart` 的 unnecessary_import），与本 spec 无关。
- `flutter test`：202 passed / 3 skipped / 0 failed。
- 新依赖：`cached_network_image: ^3.4.1`（lock 到 3.4.1）。只用它的
  `CachedNetworkImageProvider`，不用同名 widget——占位、淡入、错误 chrome 这一层
  归 fjs 自己（`mode`、圆角、`@load` / `@error` 都在这里）。没有引入
  `visibility_detector`：lazy 的可见性判断复用渲染器已有的
  RenderBox / `RenderAbstractViewport` 走法，和滚动剔除同一个时钟。
- 已登记差异：缓存实现两端不同（Flutter provider 缓存 vs 浏览器 HTTP 缓存），
  `errMsg` 是固定文案而不是平台原始错误——都写进了 `docs/web.md` 的已知差异。
