# @ufjs/webview

把网页嵌进 fjs 页面：App 使用 Flutter WebView，Web 使用 iframe。

## 安装

```bash
pnpm add @ufjs/webview
```

模块会被 fjs 自动发现和注册，不需要手动 import 组件或修改 Flutter host。

## 用法

```vue
<script setup lang="ts">
import { ref } from 'vue';

const lastMessage = ref('');

function onMessage(payload: string) {
  lastMessage.value = payload;
}
</script>

<template>
  <view class="page">
    <web-view
      class="frame"
      src="https://example.com/terms"
      @load="(payload) => console.log('loaded', payload)"
      @error="(payload) => console.error('failed', payload)"
      @message="onMessage"
    />
    <text>{{ lastMessage }}</text>
  </view>
</template>

<style scoped>
.page { flex-grow: 1; }
.frame { flex-grow: 1; }
</style>
```

`web-view` 是普通盒子，不会自动铺满页面，也不会覆盖兄弟节点。网页没有自然高度，
请给它明确的 `height`、`flex-grow` 或其它有界父容器。

## Props 和事件

| 名称 | 说明 |
|------|------|
| `src` | `http://` / `https://` 外部页面，或 `asset://<path>` 模块自带页面 |
| `@load` | 页面加载完成，载荷为 `{"src":"..."}` |
| `@error` | 主文档加载失败，载荷为 `{"src":"...","errMsg":"web-view load failed"}` |
| `@message` | 网页调用 `fjs.postMessage(string)`，载荷为 `{"data":"..."}` |

事件载荷都是字符串。需要传对象时，在网页侧先使用 `JSON.stringify`。
`src` 变化会开始新一轮加载，旧页面的事件不会回派。

## 模块自带页面

模块的 `public/` 文件会自动打包。页面使用 `asset://`，同一个地址会按目标解析：

| 目标 | 实际位置 |
|------|----------|
| App dev | `http://<devHost>/modules/webview/<path>` |
| App release | Flutter asset `assets/fjs/modules/webview/<path>` |
| Web | `/fjs-modules/webview/<path>` |

例如：

```vue
<web-view src="asset://demo.html?q=hello#top" style="height: 320px" />
```

release 会用不含 `?` / `#` 的路径查找 Flutter asset，再把 query 和 fragment 还原到
页面 URL。因此页面初始脚本可以正常读取 `location.search` 和 `location.hash`，相对
CSS、JS、图片也仍以该 HTML 的目录为基准。页面最终触发的 `@load` 仍使用完整的
`src` 语义。

## 网页与宿主通信

App 中，WebView 会提供：

```js
fjs.postMessage('hello');
```

Web 的跨源 iframe 不能由宿主注入 `fjs`，网页需要自带一个 shim：

```js
window.fjs = window.fjs || {
  postMessage: (data) => parent.postMessage({ __fjs: String(data) }, '*'),
};
```

网页里的 JavaScript 世界与 fjs 页面互不相通；网页不能 import fjs natives，只能通过
`fjs.postMessage` 发送字符串。
