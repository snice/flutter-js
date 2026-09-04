# Plan: image mode 与加载事件

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | JS runtime 统一 `src`、`mode`、`lazy-load` 与字符串事件载荷；Flutter 在 `widgets/image.dart` 负责 provider、布局和可见性；Web 在 `web/components/basic.ts` 负责 `<img>`、CSS 映射和 IntersectionObserver。 |
| II 边界即契约 | 是 | 新增 image `load/error` 事件号，同时修改 `element.ts`、`ffi.dart`、`fjs.h`；不修改 UI op、不新增 native function、不改变 C ABI。 |
| III 同步单线程零序列化 | 是 | 图片内容始终由平台 provider/浏览器加载，不经过 JSI/FFI；事件只通过既有 `String? text` 传固定 JSON 字符串。网络等待不会阻塞 JS 执行。 |
| IV 外观照 WeUI | 是 | 不增加新的装饰 chrome；保持现有内容盒、圆角和页面控件样式，`mode` 只改变图片内容的填充/对齐。加载前后的盒尺寸保持稳定，避免闪动。 |
| V 静默失效是 bug | 是 | 未知 mode、无法接入 lazy 可见性、无效 intrinsic 尺寸和过期图片回调都要 `warnOnce` 或明确丢弃；禁止静默回落到错误语义。 |
| VI 注释记录权衡 | 是 | 在 provider 选择、`mode`/`fit` 兼容、Flutter 可见性判断和错误 payload 统一处记录为什么采用当前方案。 |
| VII JS 能包就不要下 Dart | 是 | `image` 需要 Flutter `ImageProvider`/`ImageStream`、intrinsic 尺寸和 viewport 坐标判断；这些信息只有宿主渲染层可靠拥有。JS 侧只维护框架无关的解析/契约，Web 侧用原生 `<img>`。 |
| VIII 变更落到文档 | 是 | 更新 `docs/ui-api.md`、`docs/web.md` 或 `docs/css-compat.md`、`docs/roadmap.md`，并更新 `hello-fjs` 图片示例。 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| JS runtime 契约 | `packages/fjs-runtime/src/ui/element.ts` | 登记 `onLoad` / `onError`；handler 仍只发送存在标记，回调 payload 仍是字符串。 |
| JS runtime 类型 | `packages/fjs-runtime/src/vue-global.d.ts` | 扩展 `FjsImageProps`：`mode`、`lazyLoad`、`onLoad`、`onError`；事件参数标注为 JSON 字符串。 |
| JS runtime 共用逻辑 | `packages/fjs-runtime/src/image/mode.ts` | 定义 14 个合法 mode、`mode` 优先于 `fit` 的解析规则、未知 mode 的告警入口、Flutter/Web 可消费的 fit/alignment 结果。 |
| JS runtime 共用逻辑 | `packages/fjs-runtime/src/image/events.ts` | 统一 `load` / `error` payload 编码与字段顺序，统一稳定错误文案，提供单次终态状态机 helper。 |
| JS runtime 测试 | `packages/fjs-runtime/test/image-mode.test.ts`、`packages/fjs-runtime/test/image-events.test.ts` | 覆盖 14 mode、fit 兼容优先级、未知 mode 告警、payload 字符串、终态互斥和 src cycle。 |
| Web 适配层 | `packages/fjs-runtime/src/web/components/basic.ts` | 扩展 `FjsImage` props/emits；处理 lazy observer、src cycle、`load/error`、naturalWidth/naturalHeight 和 `asset://`。 |
| Web 样式 | `packages/fjs-runtime/src/web/base-css.ts` | 移除 image 固定 `object-fit: cover` 对显式 mode 的覆盖；补稳定内容盒、fix 模式包装元素和 object-position 规则。 |
| Web 样式归一化 | `packages/fjs-runtime/src/web/style.ts` | 仅在 fix 模式实现需要新增 style helper 时修改；不把 image mode 错当成 CSS 属性。 |
| Flutter image 宿主 | `packages/flutter_fjs/lib/src/widgets/image.dart` | 改成 StatefulWidget；http(s) 用 `CachedNetworkImageProvider`，asset 保持 `AssetImage`；监听 ImageStream，派发 load/error，处理 src generation、mode 和 intrinsic 尺寸。 |
| Flutter image 解析 | `packages/flutter_fjs/lib/src/render/style.dart` | 保留旧 `fit` getter；如需要，将 mode 到 `BoxFit`/`Alignment` 的纯映射放到新 helper，不让 CSS style 层读取 image props。 |
| Flutter lazy 可见性 | `packages/flutter_fjs/lib/src/render/image_visibility.dart` | 基于 RenderObject 的全局坐标、`RenderAbstractViewport` 和预加载范围判断 image 是否进入可见区域；提供注册、注销和滚动刷新接口。 |
| Flutter 滚动刷新 | `packages/flutter_fjs/lib/src/widgets/scroll_view.dart`、`packages/flutter_fjs/lib/src/widgets/list_view.dart` | 在现有滚动通知路径刷新 image visibility registry；不新增第二套滚动协议。 |
| Flutter 节点适配 | `packages/flutter_fjs/lib/src/node/node_adapters.dart` | 将 tree、node、style、dispatch、BuildContext 传入 image widget；保留通用 decoration/gesture wrapper。 |
| Flutter 事件契约 | `packages/flutter_fjs/lib/src/ffi.dart`、`packages/flutter_fjs/native/include/fjs.h` | 增加 26/27 两个事件号及 payload 注释；native 只登记号码，不新增 C ABI。 |
| Flutter 依赖 | `packages/flutter_fjs/pubspec.yaml`、`packages/flutter_fjs/pubspec.lock` | 增加 `cached_network_image` 3.4.x 兼容线；不得把依赖升级到要求 Dart 3.12 的 4.x，维持包当前 Dart 3.3 下限。 |
| Flutter 测试 | `packages/flutter_fjs/test/image_test.dart` | provider 类型、mode 布局、事件、src 切换、缓存命中、空 src、lazy-load 和滚动容器覆盖。 |
| 示例 | `examples/hello-fjs/src/pages/comp/image.vue` | 增加 mode 切换、lazy 图片、有效/无效 URL、JSON 字符串事件展示；补齐 `<route>` 说明。 |
| 文档 | `docs/ui-api.md`、`docs/web.md`、`docs/css-compat.md`、`docs/roadmap.md` | 更新 image API、14 mode、lazy/load/error 契约、缓存/可见性差异和 roadmap。 |

明确不修改：

- `packages/fjs-runtime/src/ui/ops.ts` 与 `packages/flutter_fjs/lib/src/ui_ops.dart`：props 继续走既有 `setProps`。
- `packages/fjs-runtime/src/native-global.d.ts` 与 `packages/flutter_fjs/native/src/natives.cpp`：没有新增 native 函数。
- `packages/fjs-runtime/src/tags.json` 与 `packages/fjs/src/bundler/vue-plugin.ts`：`image` 已是现有内置标签。

## 3. 方案

### 3.1 mode 与旧 fit

新增框架无关的 `resolveImageMode(mode, fit)`：

1. `mode` 明确存在时使用 mode，覆盖 fit。
2. mode 缺失而 fit 明确存在时，保留旧 fit 行为。
3. 两者缺失时使用 `scaleToFill`。
4. mode 不在 14 个合法值内时 `warnOnce`，降级到 `scaleToFill`。

统一结果包含：

- `BoxFit`/`object-fit`：fill、contain、cover。
- `Alignment`/`object-position`：top、bottom、left、right、center 及四角。
- `widthFix` / `heightFix` 的 fix 方向。

Flutter 和 Web 各自消费同一个语义结果，不在 CSS 引擎里增加 `mode` 属性。

### 3.2 图片事件

- 事件号使用当前未占用的 26 和 27：
  - `FJS_EVENT_IMAGE_LOAD = 26`
  - `FJS_EVENT_IMAGE_ERROR = 27`
- `load` payload 固定由 `encodeImageLoad(width, height)` 生成：
  `{"width":600,"height":400}`。
- `error` payload 固定由 `encodeImageError()` 生成：
  `{"errMsg":"image load failed"}`。
- Flutter ImageStream 与 Web `<img>` 都维护 cycle token 和终态 guard：
  - src 变化递增 token；
  - 回调 token 不是当前值时直接丢弃；
  - load/error 任一终态发出后，另一终态不再发；
  - 同一 token 最多派一次终态事件。

### 3.3 Flutter 图片 provider

- HTTP(S) 使用 `CachedNetworkImageProvider`，获得已有 provider 层的内存/磁盘缓存。
- asset 使用现有 `AssetImage`，不把本地资源送进网络缓存。
- 空 src 只渲染稳定空内容，不创建 provider、不派事件。
- ImageStream listener 直接读取 `ImageInfo.image.width/height`，成功后通知 fix 模式更新 intrinsic 尺寸。
- dispose 时移除 listener，并让 visibility registry 注销节点，避免节点销毁后的回调。

`cached_network_image` 只用于 provider，不使用高层 `CachedNetworkImage` builder；这样 image 仍由 fjs 的通用 decoration、圆角和节点生命周期控制。

### 3.4 Flutter lazy-load

不引入 `visibility_detector`。新增 `image_visibility.dart`，复用仓库已有的 viewport 坐标计算思路：

- image 首次布局后注册一个轻量观察项；
- 使用 image RenderBox 的 global rect 与外层 viewport rect 比较；
- 观察范围包含固定预加载 slack；
- `scroll-view` / `list-view` 收到滚动通知时刷新已注册观察项；
- image 进入范围后启动 provider，启动后不取消；
- 不在可测 viewport 内时按当前页面可见处理，并通过 `warnOnce` 记录 fallback；
- list-view 行销毁时注销观察项；节点 id/generation 共同防止旧行回调打到复用行。

### 3.5 Web image

- 继续使用原生 `<img>`，在 lazy 模式下通过包裹元素观察，进入 IntersectionObserver 范围后才设置真实 src。
- 不支持 IntersectionObserver 时 `warnOnce`，立即加载。
- 每轮 src 更新先清理旧 observer，生成新的 cycle token；旧事件不再派发。
- `load` 从 `naturalWidth`/`naturalHeight` 生成 payload，`error` 使用统一错误文案。
- `asset://` 仍只去掉 scheme。
- 普通 mode 映射为 object-fit/object-position；fix 模式使用稳定 wrapper 和加载后 intrinsic 比例更新。

### 3.6 被否掉的备选方案

- **继续使用 `NetworkImage`**：不能满足新增的缓存要求。
- **使用高层 `CachedNetworkImage` 直接替换现有 image**：placeholder/error builder、节点生命周期、intrinsic 尺寸和事件 token 会混在第三方 widget 的状态里，难以保持 fjs 现有 wrapper 语义。
- **把 image 全部实现为 JS 组件**：JS 无法取得 Flutter ImageStream、intrinsic 尺寸和 viewport 坐标，属于必须下到 Dart 的原生渲染能力。
- **引入 `visibility_detector`**：会增加依赖和平台时序，仓库已有 RenderAbstractViewport 与滚动通知基础设施可以覆盖目标场景。
- **新增 C ABI 或 invokeHost 通道**：图片数据不需要跨桥，新增通道违反现有零序列化边界。

## 4. 风险

- `widthFix` / `heightFix` 只有在图片 metadata 到达后才能精确计算，必须保证首帧有稳定盒尺寸且不会无限触发重排。
- ImageStream 可能从缓存快速回调，终态 guard 必须在 resolve 前初始化。
- `list-view` 的行复用和销毁会放大旧回调风险，必须同时校验 cycle token、node id 和 widget mounted 状态。
- Flutter `scroll-view` 的子树虽然布局完整，但 image 的可见性判断不能依赖 paint culling；应使用 RenderBox/viewport 坐标。
- Web `IntersectionObserver` 的 callback 时机与 Flutter post-frame 不同，验收应对齐“进入预加载区域后启动”和事件次数，不要求同一帧发生。
- 14 个 mode 的方向裁剪可能存在平台像素级差异，验收按内容位置、是否裁剪、是否留白判断。
- 新 pub 依赖会影响 `pubspec.lock` 和发布版本，必须在实现阶段运行 `flutter pub get` 并检查 Dart/Flutter SDK 约束。

## 5. 验证路径

```bash
# 依赖、类型和 JS 测试
cd packages/flutter_fjs
flutter pub get
cd ../..
pnpm run typecheck
pnpm --filter hello-fjs run typecheck
pnpm test

# Flutter 测试（native 已编译时）
cd packages/flutter_fjs
flutter test
cd ../..

# Web 手工验证
pnpm --filter hello-fjs run dev:web

# iOS 手工验证
pnpm --filter hello-fjs run run:ios
```

手工检查顺序：

1. 空 src、asset src、HTTP(S) src。
2. 14 个 mode；显式 mode 覆盖 fit；只写 fit 的旧页面保持旧行为。
3. lazy 图片在普通页面、scroll-view、list-view 中进入预加载区域前不请求，进入后只启动一次。
4. 有效 URL 只派一次 load；无效 URL 只派一次 error；切换 src 后旧请求结果不派发。
5. Flutter/Web 的 load/error payload 逐字符比较，确认字段顺序和错误文案一致。
