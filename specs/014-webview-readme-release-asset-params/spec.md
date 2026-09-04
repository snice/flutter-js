# Spec: web-view 文档与 release asset 参数

- **ID**: 014-webview-readme-release-asset-params
- **状态**: in-progress
- **日期**: 2026-09-04

## 1. 要解决什么

`packages/fjs-webview` 的 npm 包声明会发布 `README.md`，但仓库里没有该文件，使用者
安装模块后缺少安装、用法、事件和静态页面资源的说明。

模块自带的 `asset://` 页面在 app release 下也无法正确接收参数：

- app dev 把 `asset://demo.html?q=hello#top` 转成 HTTP URL，页面可以读取查询串和片段；
- app release 需要从 Flutter asset bundle 加载 HTML，当前实现把 `?` / `#` 截掉后只加载
  文件，页面看不到参数；如果直接把它们传给 `loadFlutterAsset`，又会把参数误当成
  manifest key，导致找不到 HTML 并抛出异常。

这会让同一份页面源码在 dev、release、web 三处出现不同结果，且带参数的模块页面在
release 中不能正常工作。

## 2. 不做什么（Non-goals）

- 不改变 `asset://` 的路径安全规则、模块资源目录结构或 `prepare.mjs` 的打包方式。
- 不改变外部 `http://` / `https://` 页面的加载和参数行为。
- 不新增 UI op、FFI/C ABI、事件号或跨线程通信。
- 不引入新的 Flutter 依赖；继续使用现有 `webview_flutter` 和 Flutter asset 机制。
- 不把任意 `file:`、`data:`、`javascript:` 等 scheme 变成可加载来源。
- 不为 README 增加与当前模块能力无关的 JSSDK、导航拦截、cookie 或安全白名单说明。

## 3. 用户可见的行为

### 3.1 README

用户安装模块后可以在 `packages/fjs-webview/README.md` 看到至少这些内容：

- `@ufjs/webview` 的安装方式；
- 不需要手动 import 或额外注册，页面可直接使用 `<web-view />`；
- `src`、`@load`、`@error`、`@message` 的最小 Vue 示例；
- app 使用 Flutter WebView、web 使用 iframe；
- 普通盒子的布局规则和尺寸要求；
- 模块自带 `public/` 页面与 `asset://` 的 dev / release / web 路径；
- 网页侧 `fjs.postMessage(string)` 的使用方式，以及 web iframe 需要 shim；
- release 下带参数的 `asset://` 页面仍可在页面中读取参数。

最小用法：

```vue
<script setup lang="ts">
import { ref } from 'vue';

const lastMessage = ref('');
</script>

<template>
  <web-view
    src="asset://demo.html?q=hello#top"
    style="height: 320px"
    @load="(payload) => console.log(payload)"
    @error="(payload) => console.error(payload)"
    @message="(payload) => { lastMessage = payload; }"
  />
  <text>{{ lastMessage }}</text>
</template>
```

### 3.2 release asset 参数

当 `src` 为 `asset://<path>?<query>#<fragment>` 时：

1. app release 根据不含 `?` / `#` 的 `<path>` 查找并加载真实 Flutter asset；
2. 页面运行时的 URL 语义保留原始 query 和 fragment：
   `location.search` 能读取 query，`location.hash` 能读取 fragment；
3. HTML 内的相对 CSS、JS、图片等资源仍相对 `<path>` 所在目录解析；
4. `@load` / `@message` 等既有事件行为不变，`@load` 的 `src` 字段仍是用户传入的完整
   `src`，不因 release 的内部加载方式而被改写；
5. app dev 和 web 的现有行为保持不变，三端使用同一份页面源码时参数结果一致；
6. 没有 query 或 fragment 的 `asset://` 页面行为与现在一致。

无法映射成合法模块路径的 `asset://` 仍然不加载并保持现有告警行为。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| `asset://` 文件定位 | release 从不含 query / fragment 的 Flutter asset key 加载 HTML；dev 继续使用 `/modules/webview/<path>` | 继续使用 `/fjs-modules/webview/<path>` |
| 页面 URL 参数 | release 加载后的文档可读取原始 `location.search` / `location.hash`；相对资源以 asset 页面路径为基准 | iframe URL 保留原始 query / fragment |
| 事件载荷 | `@load` / `@error` / `@message` 字符串契约不变，`@load.src` 保留完整输入 | 与 Flutter 逐字符相同 |
| 已知差异 | 无新增差异；release 内部不能把带参数的字符串直接当 Flutter asset key | iframe 的 `@error` 仍受浏览器限制，沿用 `docs/web.md` 的既有说明 |

如果底层 WebView 无法通过标准文档 URL 同时表达 Flutter asset key 和 query/fragment，
实现必须在页面初始脚本执行前提供等价的 `location.search` / `location.hash` 语义，
不能只在页面加载完成后再注入参数，因为页面业务脚本可能已经读取过参数。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及：仅修复模块内部的 Flutter asset 加载方式、补充 README 与测试

## 6. 验收标准

1. `test -f packages/fjs-webview/README.md` 通过，README 包含安装、最小用法、props/
   事件、两端实现、`asset://` 资源和参数说明。
2. `pnpm --filter @ufjs/webview run typecheck` 通过。
3. `pnpm test` 通过，并包含模块测试：release asset key 会去掉 query/fragment 以查找
   文件，但页面 URL/参数上下文保留完整 query/fragment；原有事件载荷和 src 切换测试
   继续通过。
4. `cd packages/fjs-webview/flutter && flutter test` 通过，覆盖：
   - `asset://demo.html?q=hello#top` 使用不带参数的 asset key；
   - 载入内容时页面能在初始脚本执行前读取 `q=hello` 与 `#top`；
   - 相对资源基准路径不因参数处理而改变；
   - 无参数 asset、空 src、非法路径和外部 URL 行为不回归。
5. `cd packages/fjs-webview/flutter && flutter analyze` 通过。
6. `pnpm --filter hello-fjs run dev:web` 的 web-view 示例中，`asset://demo.html?q=hello`
   页面能显示 `hello`，并且已有 `@load` / `@message` 行为不变。
7. app dev 下运行同一示例，页面能显示 `hello`；`@load` payload 的 `src` 包含完整
   `asset://demo.html?q=hello` 输入对应的 URL 结果。
8. 构建 release 产物后，在 iOS 模拟器或可用的 Flutter release 验证环境中运行示例：
   `asset://demo.html?q=hello#top` 能加载 HTML，不出现找不到 asset 的异常，页面显示
   `hello` 且识别 `#top`。
9. release 页面点击 `fjs.postMessage` 后，宿主仍收到 `{"data":"..."}`，且换 `src` 后
   旧页面消息不会回派。
10. 不修改核心事件号、UI op、native-global 声明或 `tags.json`；`git diff` 可确认变更
    只落在模块文档、模块实现/测试及必要的示例或说明。

## 7. 待澄清

- [ ] 无
