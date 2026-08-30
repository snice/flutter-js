# Web 平台

`fjs build --web` 把同一份 Vue 应用编译成浏览器能跑的静态站点：真 Vue
runtime-dom + vue-router，内置标签由一层 DOM 适配层实现。**页面源码一行不用改。**

```bash
pnpm run dev:web
pnpm run build:web
```

`fjs create` 生成的默认模板用 Vite 跑 Web 开发和构建，输出到 `dist/`。仓库里的
`examples/hello-fjs` 使用的是 CLI 内置 Web 模式，脚本为 `fjs dev --web` 和
`fjs build --web`，输出到 `dist/web/`。

两种方式都会走同一套 fjs Web alias：`fjs/app`、`fjs/router`、`fjs/web` 和
`fjs/pages`。产物是普通静态文件，可以交给任意静态托管。

## 它是怎么成立的

| 层 | Flutter | Web |
|---|---|---|
| 渲染器 | fjs 自定义 renderer → op 帧 → Widget | Vue runtime-dom |
| `<view>` `<swiper>` … | Dart 侧 widget 映射 | `fjs/web` 里的 Vue 组件 |
| `<style scoped>` | fjs 样式引擎（自己做 cascade / 继承） | 真 CSS（`compileStyle` 注入 `<style>`） |
| 路由 | 原生 Navigator | vue-router（hash 模式） |
| `toast()` | 原生浮层 | DOM 浮层 |
| `new Worker(code)` | Dart isolate + 独立 QuickJS | 真 Web Worker（Blob URL） |

内置标签在 web 上是**组件**（`fjs-runtime/src/web/components.ts`），在 Flutter 上
是**元素**。SFC 编译时给 `@vue/compiler-dom` 传不同的 `isNativeTag` 来切换——
`text`、`image`、`switch` 这些本来是 HTML/SVG 原生标签，不显式声明就会被编译成
真元素，永远走不到适配层。

### 事件契约

原生侧所有事件的载荷都是**字符串**（JSI 边界只过标量），web 组件原样照搬，所以
同一个 handler 两边都对：

```vue
<switch :value="wifi" @change="(v: string) => (wifi = v === '1')" />
<slider :value="n" @change="(v: string) => (n = Number(v))" />   <!-- 两位小数 -->
<swiper @page-changed="(i: string) => (index = Number(i))" />
<input :value="name" @input="(t: string) => (name = t)" />
```

### 样式

`:style="{ fontSize: 16 }"` 在 Flutter 上是 16 像素，在 CSS 里是非法值。适配层
统一把数字按长度属性补 `px`（`opacity` / `flexGrow` / `lineHeight` 等无单位属性
除外），所以内联样式也不用分平台写。

基础样式表（`fjs-runtime/src/web/base-css.ts`）把容器都做成 `box-sizing:
border-box` 的列 flexbox，`stack` 用 CSS grid 让子节点重叠——对齐 Flutter 的
「padding 在盒内、margin 在盒外」和 `Stack` 语义。

## 已知差异

- **`flex-direction: row` 的交叉轴默认值**：Flutter 是 `center`，CSS 是
  `stretch`。在乎的地方显式写 `align-items`。
- **页面状态**：web 默认 `<KeepAlive>`（返回时还原滚动位置和局部状态），Flutter
  出栈即销毁。要一致就传 `keepAlive: false`。
- **`refresh` 下拉刷新**：web 只做了触摸端的简化版；纯桌面浏览器上拉不出来。
  这类页面可以用 `<route>` 的 `"platforms": ["app"]` 只在 App 端提供。
- **`platforms` 门控**：web 构建的路由表里不会出现 App 专属页面，页面代码也不会
  进产物。
- **页面组件要有单一根节点**：页面转场用 `<Transition>` 包着，多根节点会退化。

## 选项

```ts
createFjsApp({
  routes,
  shell: Shell,
  history: 'hash',      // 默认；'history' 需要服务端回退到 index.html
  keepAlive: true,      // true / false / 数字（最多缓存几页）
  transition: 'fjs-page', // 或 false 关掉页面转场
  el: '#app',
});
```

`history` / `keepAlive` / `transition` / `el` 只在 web 生效，Flutter 侧忽略；
`rootTag` 只在 Flutter 生效。两边共用一份 options 是刻意的——`main.ts` 不用分叉。

## 相关

- [路由](routing.md)
- [UI 标签参考](ui-api.md)
