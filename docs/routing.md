# 路由：一份代码，两套导航

同一个 `router.push('/comp/button')`，在两个平台上落到完全不同的东西上：

| | Flutter | Web |
|---|---|---|
| 谁在管页面栈 | Flutter 的 `Navigator`（原生路由） | vue-router |
| 转场动画 | 平台自带（iOS 右滑推入、Android 系统转场） | CSS transition |
| 返回手势 | 平台自带（iOS 边缘滑动、Android 返回键 / 手势） | 浏览器后退 |
| 一个页面 = | 一个 `.js` / `.fjsbundle` chunk，按需加载 | 一个 esbuild chunk，`import()` 按需加载 |
| 页面状态 | 出栈即销毁（和原生一致） | 默认 `<KeepAlive>`：新页从 0,0 起，返回还原离开时的滚动 |

应用代码不知道自己在哪边：都写 `useRouter()` / `useRoute()`，构建时 `fjs/router`
被 alias 到对应实现（`router/flutter.ts` 或 `router/web.ts`）。

## 应用入口

```ts
// src/main.ts —— 两个平台完全相同
import { createFjsApp } from 'fjs/app';
import { routes } from 'fjs/pages';   // 构建时生成，见下
import Shell from './Shell.vue';

createFjsApp({
  routes,
  shell: Shell,              // 每个页面都被它包一层
  setup(app) { /* 装插件、错误处理 */ },
}).mount();
```

`shell` 拿到一个 `route` prop、页面放在它的默认插槽里。Flutter 上它是每个原生
路由页的外壳；web 上也是每个历史条目一份（`<KeepAlive>` 按栈缓存），外壳里的
`<scroll-view>` 不会串到下一页。导航栏 / tabBar 只写一遍：

```vue
<!-- Shell.vue -->
<script setup lang="ts">
import type { RouteLocation } from 'fjs/router';
const props = defineProps<{ route: RouteLocation }>();
</script>
<template>
  <safe-area><view class="shell">
    <NavBar :title="String(route.meta.title ?? '')" />
    <scroll-view class="body"><slot /></scroll-view>
  </view></safe-area>
</template>
```

## API

`fjs/router` 的表面是 vue-router 的子集，语义对齐：

```ts
import { useRouter, useRoute } from 'fjs/router';

const router = useRouter();
router.push('/comp/button');                   // 原生 push（有转场、可手势返回）
router.push({ path: '/detail', query: { id: '3' } });
router.push({ name: 'detail', params: { id: 3 } });
router.replace('/api');                        // 原地换页，不进栈——切 tab 用它
router.back();                                 // = 平台返回
router.go(-2);

const route = useRoute();                      // 响应式：path / params / query / meta
```

- `useRoute()` 返回的是**当前组件所属页面**的 route（Flutter 侧按页 provide，
  web 侧走 vue-router 自己的注入），不是全局栈顶。
- `go(n)` 只支持负数：原生栈没有前进历史。
- `replace` 在栈只有首页时是「原地重挂载首页」，这正是 tabBar 想要的行为
  （无转场，和小程序一致）。

## 页面路由自动生成

`src/pages/**/*.vue` 就是路由表，`fjs build` 把它生成成虚拟模块 `fjs/pages`：

```
src/pages/index.vue        ->  /              chunk "index"
src/pages/about.vue        ->  /about         chunk "about"
src/pages/comp/button.vue  ->  /comp/button   chunk "comp-button"
src/pages/user/[id].vue    ->  /user/:id      chunk "user-id"
src/pages/[...all].vue     ->  /*             chunk "all"
```

文件名按 kebab-case 转换（`ButtonPage.vue` → `/button-page`），`index.vue` 取父
目录路径，`[id]` 是动态段。

### `<route>` 块：标题、meta、平台

```vue
<route>
{ "title": "按钮", "tag": "button", "group": "表单组件", "platforms": ["app"] }
</route>
```

- `path` / `name` / `platforms` 由生成器读取，其余字段进 `route.meta`
- `platforms` 缺省是 `["app", "web"]`；写 `["app"]` 表示**这个页面只有 App 端
  有**——web 构建的路由表里根本不会出现它，页面代码也不会进 web 产物
- 也可以用文件名后缀简写：`about.app.vue` / `about.web.vue`

因为路由表本身就是「当前平台真正存在的页面」，首页那种目录/导航列表直接读
`routes` 就行，不用再手写一份并且两边对不上：

```ts
import { routes } from 'fjs/pages';
const items = routes.filter((r) => r.meta?.group === '表单组件');
```

## Flutter 侧：一个路由 = 一个原生页面

宿主用 `FjsApp` 代替 `FjsView`：

```dart
MaterialApp(home: FjsApp(engine: engine))
```

`FjsApp` 是一个由 JS 路由驱动的 `Navigator`。协议全部走已有的通道，没有新的
FFI 入口：

```
JS -> Dart   invokeHost('fjs.nav.push',    key, fullPath, title, chunk)
             invokeHost('fjs.nav.replace', key, fullPath, title, chunk)
             invokeHost('fjs.nav.load',    key, fullPath, chunk)   // 首页换页
             invokeHost('fjs.nav.pop')
Dart -> JS   dispatchEvent(key, 10 /* navMount */)  chunk 已在 VM 里，挂载吧
             dispatchEvent(key, 11 /* navPop */)    路由没了，卸载
```

一次 push 的完整时序：

1. JS `router.push(path)` 解析路由，分配 key，调 `fjs.nav.push`
2. Dart 把 `NavEntry` 加进 `engine.navStack` 并 `notifyListeners()`——**转场立刻
   开始**，页面内容还没到时先显示 `placeholder`
3. Dart 异步 `chunkLoader(chunk)` 取到 chunk 并 eval 进同一个 VM（已加载过的
   chunk 直接跳过），然后回派 `navMount`
4. JS 建一个新的根元素（打上 `__navKey` 标记）、把页面组件挂上去
5. `FjsView(navKey: n)` 只渲染 `__navKey == n` 的那棵根子树

返回时反过来：Navigator 出栈 → `onDidRemovePage` → `engine.onRouteRemoved(key)`
→ 回派 `navPop` → JS `app.unmount()` + 删根元素。所以**手势返回和 `router.back()`
是同一条路径**，不存在两边状态不一致。

> `onRouteRemoved` 把回派放进 microtask：Navigator 是在自己的 build 里报告移除
> 的，而回派会重新进入 VM、产生 UI 帧、再 `notifyListeners()`——同步做就是一次
> build 期间的 setState。

`FjsApp` 还用 `NavigatorPopHandler` 包了一层，嵌套在宿主 Scaffold 里时系统返回
键也能落到这个 Navigator 上。

## 分包：shared prelude + 每页一个 chunk

`fjs build --pages` 产出三种东西：

| 产物 | 内容 |
|---|---|
| `dist/shared.js` | **prelude**：vue + fjs 运行时 + 应用自己的公共模块（Shell、组件、store），挂到 `globalThis.__FJS_SHARED` |
| `dist/bundle.js` | 应用入口，只剩 `main.ts` 自己（hello-fjs 实测 2.4 KB） |
| `dist/pages/<chunk>.js` | 每个路由一个，只有这个页面的代码（6–12 KB） |

hello-fjs 实测（`--pages --bytecode`）：

```
shared.fjsbundle   1,210,078 B   ← 每个 VM 装一次
bundle.fjsbundle       6,163 B
pages/comp-button.fjsbundle   23,811 B   ← 进一个页面才下载/加载这一份
```

**哪些模块进 shared** 是自动算的，不用配置：入口能到达的模块（外壳、组件），
加上**被两个以上页面引用**的模块（hello-fjs 里的 `Panel.vue`）。页面文件本身
永远不进——它们就是 chunk。实现是先跑一次 esbuild probe（`write: false` +
metafile，一次带上所有入口），按每个 output 的 inputs 统计。

宿主怎么用：

```dart
// prelude 注册一次，engine.reset() 会自动重放进新 VM
engine.addPrelude(await loadShared());
// 路由要页面时按 chunk 名取
engine.chunkLoader = (chunk) async => loadPageChunk(chunk);
engine.runBundle(await loadApp());
```

`fjs dev --pages` 把这三样分别挂在 `/shared.js`、`/bundle.js`、`/pages/<id>.js`，
并在 `/manifest.json` 里写 `"split": true`。`connectDev()` 看到这个标记就自动
注册 prelude、接上 chunkLoader——**fjs go 不用改任何代码就能跑分包工程**，热重载
时 shared 和 bundle 一起重新拉取（外壳代码也可能变）。

不带 `--pages` 时是单包：路由表里直接 `import` 每个页面并 `definePage` 注册，
`chunk` 字段为空，push 时 Dart 不做任何加载，直接回派 `navMount`。开发期和小
工程用这个更简单。

## 一个坑：页面文件名和内置标签同名

`src/pages/comp/divider.vue` 里写 `<divider />` 时，`@vue/compiler-dom` 会把
**文件名推断成组件名**，于是这个标签被当成「自引用组件」，页面无限递归自己
渲染自己（表现是 `RangeError: Maximum call stack size exceeded`）。

fjs 的 SFC 插件给编译器传了 `isNativeTag`，把内置标签集合声明成元素，所以这个
问题在 flutter-js 里不存在；web 构建则相反——把同一批标签声明成**组件**，好让
它们走到 DOM 适配层。两个方向都在 `packages/fjs/src/vue-plugin.ts` 里。

## 相关

- [Web 平台](web.md)
- [分包与 release assets](code-splitting.md)
- [Vue 3 集成](vue3.md)
