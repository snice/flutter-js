# Spec: image mode 与加载事件

- **ID**: 010-image-mode-events
- **状态**: done
- **日期**: 2026-09-04

## 1. 要解决什么

当前内置 `image` 只支持 `src` 与 `fit`：

- Flutter 侧只能把 `fit` 解析为少数 `BoxFit`，网络图使用 `NetworkImage`，没有缓存、占位、加载失败和加载完成事件。
- Web 侧只转发 `src`，固定使用 `object-fit: cover`，没有与 uni-app `image` 对齐的 `mode` 语义。
- 两端都没有 `load` / `error` 事件，因此页面无法知道图片何时加载完成或失败。
- `lazy-load` 尚未有统一的 props 契约和两端行为。

这使得同一份页面代码无法可靠表达头像、缩略图、背景裁剪、原图比例展示，以及网络图片加载状态。

需求参考：

- uni-app `image` 组件文档：`https://uniapp.dcloud.net.cn/component/image.html`
- Flutter 网络图片缓存实现采用 `cached_network_image`。

## 2. 不做什么（Non-goals）

- 不实现 `webp` / `avif` 等图片格式转换、图片压缩或 CDN 参数拼接。
- 不新增图片预加载、全局图片缓存管理或 JS 可调用的缓存清理 API。
- 不实现 `show-menu-by-longpress`、`draggable` 等非本次 image mode / 加载事件范围的 uni-app 扩展。
- 不通过新增 JSON/对象桥传递图片数据；图片内容仍由平台图片 provider / 浏览器加载。
- 不改变现有 `src` 的 asset 路径约定：`asset://foo` 与非 URL 字符串仍按 Flutter asset、Web bundle 路径处理。
- 不保证 Flutter 与 Web 使用同一个缓存实现；两端只对齐可观察的组件 props、布局语义和事件载荷。

## 3. 用户可见的行为

页面可以这样使用：

```vue
<script setup lang="ts">
import { ref } from 'vue';

const loaded = ref('');
const failed = ref('');

function onLoad(payload: string) {
  const { width, height } = JSON.parse(payload) as {
    width: number;
    height: number;
  };
  loaded.value = `${width}x${height}`;
}

function onError(payload: string) {
  failed.value = (JSON.parse(payload) as { errMsg: string }).errMsg;
}
</script>

<template>
  <image
    src="https://example.com/photo.jpg"
    mode="aspectFill"
    lazy-load
    @load="onLoad"
    @error="onError"
  />
</template>
```

### 3.1 `src`

- `http://` / `https://`：Flutter 使用带内存/磁盘缓存的网络图片 provider；Web 使用浏览器 `<img>` 网络加载。
- `asset://foo`：Flutter 去掉 scheme 后加载 Flutter asset；Web 去掉 scheme 后加载 bundle 路径。
- 其它非空字符串：按现有 asset 约定处理。
- 空 `src`：不发 `load` 或 `error`，渲染一个不请求资源的空图片内容。
- `src` 变化后视为一次新的加载周期：旧请求的完成/失败结果不得回派到新 `src`。

### 3.2 `mode`

`mode` 是 image 的 props，不是 CSS `object-fit` 字符串。支持 uni-app 文档中的 14 个值：

| mode | Flutter / Web 语义 |
|---|---|
| `scaleToFill` | 拉伸填满内容盒，不保持宽高比 |
| `aspectFit` | 保持宽高比完整显示，内容盒留空白 |
| `aspectFill` | 保持宽高比填满内容盒，超出部分裁剪 |
| `widthFix` | 宽度固定，高度按原图比例计算 |
| `heightFix` | 高度固定，宽度按原图比例计算 |
| `top` | 保持原图比例，贴内容盒顶部，必要时裁剪横向溢出 |
| `bottom` | 保持原图比例，贴内容盒底部，必要时裁剪横向溢出 |
| `center` | 保持原图比例，居中显示，必要时裁剪 |
| `left` | 保持原图比例，贴左侧，必要时裁剪 |
| `right` | 保持原图比例，贴右侧，必要时裁剪 |
| `top left` | 保持原图比例，贴左上角，必要时裁剪 |
| `top right` | 保持原图比例，贴右上角，必要时裁剪 |
| `bottom left` | 保持原图比例，贴左下角，必要时裁剪 |
| `bottom right` | 保持原图比例，贴右下角，必要时裁剪 |

- 默认 `mode` 为 `scaleToFill`，与 uni-app `image` 默认值一致；现有只写 `fit` 的页面继续保持当前 `fit` 行为。
- 未知 `mode` 必须 `warnOnce`，并降级到默认 mode；不能静默回落。
- `mode` 与现有 `fit` 同时存在时由显式 `mode` 优先；只有没有 `mode` 时才读取显式 `fit`。
- `widthFix` / `heightFix` 需要使用图片 intrinsic 尺寸；加载前不能导致父布局抖动，无法取得 intrinsic 尺寸时按普通内容盒渲染并在 `warnOnce` 中说明。

### 3.3 `lazy-load`

- `lazy-load` 为 boolean props，默认 `false`。
- `true` 时，图片进入可视区域附近才开始请求；未进入前不触发网络请求，也不派 `load` / `error`。
- 只对页面当前可观察的滚动容器生效；实现不得要求页面改写为平台专属 API。
- 图片离开可视区域后不取消已开始的请求，也不清除缓存；再次进入时复用已加载结果。
- Web 使用 `IntersectionObserver`，Flutter 使用等价的 viewport 可见性判断；两端在普通页面和 `scroll-view` / `list-view` 中都必须可用。
- 不支持 lazy-load 的宿主场景必须显式 `warnOnce` 并退化为立即加载，不能静默假装延迟。

### 3.4 `load` / `error`

- `@load` 只在当前 `src` 成功加载一次后派发；payload 是 JSON 字符串：

  ```json
  {"width":600,"height":400}
  ```

- `width` / `height` 是图片 intrinsic 像素尺寸，字段顺序固定为 `width`、`height`，数值不带单位。
- `@error` 只在当前 `src` 加载失败一次后派发；payload 是 JSON 字符串：

  ```json
  {"errMsg":"image load failed"}
  ```

- `errMsg` 必须是非空、可读的字符串；不得把平台异常对象或跨桥不可序列化对象直接交给 JS。
- `load` 与 `error` 互斥；同一加载周期不能同时派发，也不能因组件重建重复派发。
- 未监听事件时仍应完成图片加载和缓存，不因为没有 handler 而改变视觉行为。
- 事件载荷在 Flutter 与 Web 逐字符一致；平台原始错误文本只允许作为统一格式中的稳定消息组成部分，不能让同一错误在两端因异常类名不同而产生不稳定契约。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| `src` | `http(s)` 使用 `cached_network_image`；asset 使用现有 asset provider | 原生 `<img>`；`asset://` 去掉 scheme |
| `mode` | 映射到 `BoxFit` + 对齐方式；`widthFix` / `heightFix` 依据 intrinsic 尺寸处理 | 映射到 `object-fit` + `object-position`，必要时用包裹布局表达 fix 模式 |
| `lazy-load` | 依据宿主 viewport / scrollable 可见范围延迟 provider 请求 | `IntersectionObserver` 延迟设置实际 `src` |
| `load` | 图片 provider 成功完成后派发 | `<img>` `load` 后派发 |
| `error` | 图片 provider 失败后派发 | `<img>` `error` 后派发 |
| 事件载荷 | JSON 字符串，`load` 为 `{"width":n,"height":n}`，`error` 为 `{"errMsg":"..."}` | 与 Flutter 逐字符相同 |
| 已知差异 | 缓存由 Flutter provider 管理；某些平台只能提供统一错误消息 | 缓存由浏览器 HTTP cache 管理；浏览器不会暴露平台异常类型 |

做不到逐项相同的底层实现不视为契约差异；用户可观察的 mode、延迟加载时机、事件次数和事件字符串必须一致。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）—— 未动
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）—— 未动
- [x] 事件类型（`element.ts` + `fjs.h`）：26 `onLoad` / 27 `onError`
- [x] `FjsEvent` Dart 常量与图片事件 dispatch 适配
- [x] image props 类型（`vue-global.d.ts`）与模板事件类型
- [x] 事件类型若新增只需要事件号登记，不修改 C ABI 参数形状；载荷仍为字符串

## 6. 验收标准

1. `pnpm run typecheck` 通过，且 `image` 的 `src`、`mode`、`lazy-load`、`onLoad`、`onError` 类型可被 `hello-fjs` 模板识别。
2. `pnpm test` 通过，并包含纯 JS 测试：14 个 mode 的归一化/映射、未知 mode 的 `warnOnce`、load/error payload 字段顺序和字符串编码、同一 `src` 至多一次终态事件。
3. `cd packages/flutter_fjs && flutter test` 在已编译 native 的环境下通过，并包含：网络 provider 选择、缓存 provider、14 个 mode 的 BoxFit/对齐、空 src、src 切换丢弃旧结果、load/error 单次派发、lazy-load 在滚动容器中进入视口后才请求。
4. `pnpm --filter hello-fjs run typecheck` 通过，并新增 image 示例覆盖：`scaleToFill`、`aspectFit`、`aspectFill`、`widthFix`、`heightFix`、至少一个角落对齐 mode、`lazy-load`、`@load`、`@error`。
5. 在 `pnpm --filter hello-fjs run dev:web` 中操作示例页：模式切换后图片裁剪/留白/对齐符合表格；lazy 图片进入视口前不请求，进入后只派一次 `load` 或 `error`；故意使用无效 URL 时只派一次 `error`。
6. 在 iOS 模拟器上运行同一示例页：远程图片能显示缓存后的结果；模式切换与 Web 视觉语义一致；`load` / `error` 载荷与 Web 逐字符一致；lazy 图片滚入视口后才开始加载。
7. 更新 `docs/ui-api.md`：补充 image props、14 个 mode、`lazy-load`、`load/error` 载荷和事件次数语义。
8. 更新 `docs/web.md` 或 `docs/css-compat.md`：记录 Flutter `cached_network_image` 与 Web 浏览器缓存/IntersectionObserver 的实现差异。
9. 更新 `docs/roadmap.md`，登记 image mode、lazy-load 和 load/error 已完成。
10. `/plan` 阶段完成宪法自查：若使用新 pub 依赖，说明依赖理由、版本约束、发布/锁文件影响；若 `widthFix` / `heightFix` 或 lazy-load 无法在当前宿主可靠实现，必须在本 spec 标出具体降级行为后再实现。

## 7. 待澄清

- [x] 已确认：显式 `mode` 优先于 `fit`。
- [x] 已确认：本次包含 `lazy-load`。
