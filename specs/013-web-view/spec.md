# Spec: web-view 模块

- **ID**: 013-web-view
- **状态**: done
- **日期**: 2026-09-04

## 1. 要解决什么

页面现在没有任何办法嵌一张网页。所有需要「一部分内容来自 H5」的场景都做不了：

- 用户条款、隐私政策、帮助中心这些本来就写在 CMS 里的长文；
- 活动页、营销页——运营改一次就得发一次版；
- 已经有 H5 实现、短期内不打算用 fjs 重写的老页面。

绕过去的办法都不成立：跳系统浏览器会离开应用，把 HTML 塞进 `text` 只会看到一堆标签
——fjs 实现的是 CSS 子集，没有 DOM，也不打算有（`docs/principles.md` 决策一）。

参考：微信小程序 `web-view` 组件文档
`https://developers.weixin.qq.com/miniprogram/dev/component/web-view.html`

## 2. 不做什么（Non-goals）

- **不进内置标签**：这是一个**模块** `@ufjs/webview`（见 §3.1），`tags.json` 不加条目。
- **不做域名白名单**。小程序要在后台配业务域名，那是平台审核机制，不是渲染器的职责。
- **不做 JSSDK**：`wx.miniProgram.navigateTo` / `getEnv` / `switchTab` 全不实现。网页想让
  宿主做事，只有 `@message` 一条路。
- 不做 cookie 管理、文件上传下载、自定义 User-Agent、缩放控制、进度条配置。
- 不做导航拦截、不做前进后退 API。
- 不实现小程序「攒消息、后退时一次性交付」的 postMessage 语义（见 §3.5）。
- 不改 UI op 协议，不新开 C ABI。

## 3. 用户可见的行为

```bash
pnpm add @ufjs/webview      # 装上即用，没有第二步
```

```vue
<script setup lang="ts">
import { ref } from 'vue';

const fromPage = ref('');

function onMessage(payload: string) {
  const { data } = JSON.parse(payload) as { data: string };
  fromPage.value = data;
}
</script>

<template>
  <view class="page">
    <text class="title">用户条款</text>
    <web-view
      class="frame"
      src="https://example.com/terms"
      @load="(p: string) => console.log('loaded', p)"
      @error="(p: string) => console.log('failed', p)"
      @message="onMessage"
    />
    <text>{{ fromPage }}</text>
  </view>
</template>

<style scoped>
.page { flex-grow: 1; }
/* 就是个普通盒子：想铺满写 flex-grow，想留一半就给高度 */
.frame { flex-grow: 1; }
</style>
```

### 3.1 形态：模块，不是内置标签

`web-view` 由 `packages/fjs-webview/`（包名 `@ufjs/webview`）提供，形状照
`packages/fjs-iconmind`：一个 npm 包同时带 Vue 组件（web 侧）、Flutter widget（app 侧）
和一个 prepare 钩子，装上即 autolink，页面直接写 `<web-view />`，不用 import、不用配置。

这么定的理由不是「够用就行」，而是**依赖代价不该由所有人付**：`webview_flutter` 要求
Dart SDK `^3.5.0`，而 `flutter_fjs` 现在声明 `>=3.3.0`。做成内置标签就得把核心的下限
一起抬上去，所有不用 web-view 的应用都跟着受限；做成模块，这条约束只落在模块自己的
`flutter/pubspec.yaml` 上（`fjs_iconmind` 已经是 `sdk: ^3.5.4`），装的人才付。

**事件号仍然由核心统一发**（宪法 II）：模块用 26 / 27 / 29，不自己造号。三张表是号段的
唯一权威，模块只是使用者。

### 3.2 布局：普通盒子，不是全屏罩

小程序规定 `web-view` 自动铺满整页、覆盖其他组件、每页只能有一个。**fjs 不跟**：它是
受样式约束的普通节点，`width` / `height` / `flex-grow` 都算数，一页放几个都行。

理由是 fjs 是通用渲染器，一个「无视样式、强制铺满、还挤掉兄弟节点」的标签会和其它所有
标签的布局规则冲突。想要小程序那种效果写 `flex-grow: 1`。差异写进 `docs/ui-api.md`。

没有任何尺寸时（父容器也不约束），渲染成**零高空盒子**并 `warnOnce`——网页容器不该
靠猜定高度。

### 3.3 `src`

支持两种 scheme：

| scheme | 含义 | app | web |
|---|---|---|---|
| `http(s)://` | 外部网页 | `loadRequest` | `iframe.src` |
| `asset://<path>` | **模块自带的页面**（见 §3.4）| dev 走 dev server，release 走 Flutter asset | 走站点根下的同一路径 |

- 其它 scheme（`file:`、`javascript:`、`about:`、`data:`）一律 `warnOnce` 后不加载：
  可用性两端差太远，给了就是不可移植的坑。
- 空 `src`：渲染空盒子，不发请求，不派任何事件。
- `src` 变化视为一次新的加载：旧页面的 `@load` / `@error` / `@message` 不得回派到新
  `src` 上。
- 不替页面改 URL（小程序文档里「中文要 encodeURIComponent」那条提醒照抄进
  `docs/ui-api.md`，但不代劳）。

### 3.4 模块自带的静态页面：dev 走 dev server，release 打进包

模块可以带一个 `public/` 目录。prepare 钩子把它写进 `.fjs/modules/webview/`，两个目标
各自读同一份：

| | app dev | app release | web |
|---|---|---|---|
| 文件在哪 | `.fjs/modules/webview/` | Flutter assets `assets/fjs/modules/webview/` | 应用的 `public/fjs-modules/webview/` |
| 谁提供 | `fjs dev` 的 `/modules/webview/<path>`（已有能力）| `WebViewController.loadFlutterAsset` | vite 的静态服务 |
| `src` 怎么写 | `asset://demo.html` | 同左 | 同左 |

页面永远只写 `asset://demo.html`，三种情况由模块自己解析。**web 那一栏需要 prepare 钩子
在 `platform === 'web'` 时把文件复制进应用的 `public/`**——vite 不服务 `.fjs/`，这是
唯一不用改 vite 配置就能让同一个 `src` 在三处都成立的办法。

### 3.5 `@load` / `@error` / `@message`

| 事件 | 载荷 | 何时派 |
|---|---|---|
| `@load` | `{"src":"https://example.com/terms"}` | 当前 `src` 加载完成一次后 |
| `@error` | `{"src":"https://…","errMsg":"web-view load failed"}` | 当前 `src` 加载失败一次后 |
| `@message` | `{"data":"来自网页的字符串"}` | 网页每调一次 `fjs.postMessage`，**立刻**派一条 |

- 字段顺序固定，两端逐字符相同。
- `load` 与 `error` 互斥，同一加载周期只派一个，组件重建不补派。
- `errMsg` 是稳定文案：WKWebView 和浏览器给的错误串完全不同，放进契约等于没有契约。
- `data` 是网页传的那一个字符串。传对象自己 `JSON.stringify`——跨这道边界的只有字符串。
- `@message` 每调一次派一次，**不合并、不排队**。与小程序的差异（它攒成数组，只在后退 /
  销毁 / 分享 / 复制链接时一次性交付）必须写进 `docs/ui-api.md`：实时双向才是正常用法，
  而且「分享」「复制链接」这两个时机 fjs 根本没有，照搬只会得到一个残缺的状态机。
- `@load` / `@error` **复用现有事件号 26 / 27**，含义从「image 的加载结果」放宽成「这个
  节点的资源加载结果」，载荷形状由标签决定。理由见 §5。

### 3.6 网页那一侧怎么发消息

| | App（Flutter） | Web |
|---|---|---|
| 宿主注入 | 有：`window.fjs.postMessage(string)`，JavaScriptChannel 提供 | **没有**：跨源 iframe 注入不了脚本 |
| 网页怎么写 | `fjs.postMessage('hi')` | 同一行，但网页要自带 shim |

```js
window.fjs = window.fjs || {
  postMessage: (data) => parent.postMessage({ __fjs: String(data) }, '*'),
};
```

这是**已登记的两端差异**：能不能注入取决于 substrate。web 侧只接收 `event.source` 是这个
iframe、且形如 `{__fjs: string}` 的消息，页面里别人的 postMessage 一律忽略。

网页也可以靠 `window.fjs` 是否存在判断自己跑在 App 里还是浏览器里（对应小程序的
`window.__wxjs_environment`）。

**两个 JS 世界互不相通**：网页里没有 fjs 的 natives，也 import 不到 `fjs`，只有
`@message` 这一条字符串通道。这一条要在 `docs/ui-api.md` 明说。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 落点 | `packages/fjs-webview/flutter/lib/fjs_webview.dart`，`engine.components.register('web-view', …)` | `packages/fjs-webview/components/WebViewWeb.vue`，`<iframe class="fjs-web-view">` |
| 控件 | `webview_flutter` 的 `WebViewWidget`（iOS WKWebView / Android WebView）| 原生 iframe |
| 布局 | 普通节点，受 `FjsStyle` 约束 | 同左，`border: 0` |
| `@load` | `NavigationDelegate.onPageFinished` | iframe 的 `load` |
| `@error` | `onWebResourceError`，只认主文档 | iframe 的 `error`（**多数情况下不会来**，见下）|
| `@message` | `JavaScriptChannel(name: 'fjs')` | `window` 的 `message`，按 source + `{__fjs}` 过滤 |
| `asset://` | dev：dev server 的 `/modules/webview/…`；release：`loadFlutterAsset` | `/fjs-modules/webview/…` |
| 事件载荷 | 固定 JSON 串 | 与 Flutter 逐字符相同 |

**必须登记的差异**：浏览器对跨源 iframe 的加载失败基本不给信号——HTTP 404 / 500 会正常
触发 `load`（加载到了一张错误页），网络层失败通常什么都不派。所以 web 侧的 `@error` 很少
会来。页面不能拿它做失败检测；要可靠就让网页在加载完成时 `fjs.postMessage('ready')`。
写进 `docs/web.md`。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）—— 不涉及
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）—— 不涉及
- [x] 事件类型（`element.ts` + `fjs.h`）：新增 `onMessage: 29` / `FJS_EVENT_MESSAGE = 29`；
      载荷仍是字符串。**号由核心发，模块只使用**
- [x] `FjsEvent.message` Dart 常量
- [x] **26 / 27 含义放宽**：`FJS_EVENT_IMAGE_LOAD` / `_IMAGE_ERROR` 改名
      `FJS_EVENT_LOAD` / `FJS_EVENT_ERROR`（**值不变**），注释写清「载荷形状由标签决定：
      image 是 `{width,height}`，web-view 是 `{src}`」。模板里 `@load` 给出的 prop 就是
      `onLoad`，为了换号而改事件名只会让页面写起来别扭
- [x] `tags.json` **不动**（模块 widget 走 `fjs.widgets` 声明）
- [x] 新 pub 依赖 `webview_flutter` 只进模块的 `flutter/pubspec.yaml`，**核心的
      `environment.sdk` 不动**

## 6. 验收标准

1. `pnpm run typecheck` 与 `pnpm --filter hello-fjs run typecheck` 通过；`web-view` 的
   `src` 与三个事件在 `hello-fjs` 模板里有类型（走模块生成的 `src/fjs-modules.d.ts`）。
2. `pnpm test` 通过，并包含模块自己的纯 JS 测试：三种载荷的字段顺序、`src` 的 scheme
   校验与告警、终态互斥、`src` 切换丢弃旧结果、`asset://` 在三种场景下解析成的 URL。
3. `cd packages/fjs-webview/flutter && flutter test` 通过（`No tests ran` 视为失败），
   覆盖：`src` 变化重新加载、`@load` / `@error` 单次派发、channel 消息变成 `{"data":…}`、
   空 `src` 不建控件、没有尺寸时的 `warnOnce`。
4. `cd packages/flutter_fjs && flutter test` 仍全绿（26/27 改名不能碰坏 image）。
5. `pnpm --filter hello-fjs run dev:web` 上操作示例页：网页显示；`asset://demo.html` 能
   加载到模块自带的页面；点网页里的按钮，`@message` 收到 `{"data":…}`；换 `src` 后旧页面
   的消息不再回派。
6. iOS 模拟器上跑同一页：网页显示**且能滚动**；`asset://demo.html` 走 dev server；
   `@load` 载荷与 web 逐字符一致；`fjs.postMessage` 回到 `@message`。**Android 不测**。
7. 两端各放一个「一半 web-view 一半原生」的布局，确认没有铺满整页、兄弟节点照常显示。
8. `fjs build --release` 后 `.fjs/modules/webview/` 的文件出现在 Flutter host 的
   `assets/fjs/modules/webview/`（只验产物存在，不跑真机 release）。
9. 更新 `docs/ui-api.md`（web-view 的 props/事件、布局差异、`@message` 立即派、网页侧
   shim、两个 JS 世界不相通）、`docs/web.md`（iframe 的 error 不可靠、注入不了脚本）、
   `docs/modules.md`（模块带静态资源的这条路子）、`docs/roadmap.md`（登记 + 新依赖只落
   模块）。
10. `/plan` 阶段完成宪法自查：为什么必须落 Dart（宪法 VII）、新 pub 依赖的版本约束与
    影响范围、模块 widget 如何拿到核心的事件号。

## 7. 待澄清

- [x] 已确认：做成模块 `@ufjs/webview`，照 `packages/fjs-iconmind` 的形状。
- [x] 已确认：静态资源 dev 走 dev server、release 打进 `.fjs/modules`。
- [x] 已确认：`@message` 立即派，不照搬小程序的攒批语义。
- [x] 已确认：当普通盒子，不强制铺满整页。
