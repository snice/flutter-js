# @ufjs/iconmind

[IconMind](https://iconmind.dev)（MIT，2,437 个图标）包成一个 fjs 模块：一个标签，
两端各画各的。

仓库里的 `demo` 就是这么用它的：一条 npm 依赖，没有别的。

## 使用者要做的事

```bash
npm i @ufjs/iconmind
```

```vue
<template>
  <!-- App 上 Flutter 绘制，Web 上内联 SVG -->
  <icon-mind name="agent" :size="28" color="#5b4bde" @tap="onTap" />
  <icon-mind name="firewall" variant="duotone" weight="bold" />
</template>
```

没有第二步：不用写脚本，不用改 package.json，不用手动列图标。组件也不用 import，
`<icon-mind />` 是模块的 widget，由工具链注册。

## 为什么不用配置

模块自带一步构建（`package.json` 的 `fjs.prepare` → `prepare.mjs`）。fjs 在每次
`build` / `dev` / Vite 启动前调用它，它做三件事：

1. 扫描 app 的源码，找出模板里写了哪些 `<icon-mind name="…" />`；
2. 从 `@iconmind/icons` 取出这些图标的形状，写 `.fjs/modules/iconmind/icons.json`；
3. 把这些名字写成 `types.d.ts`，于是 `name` 能补全、写错是编译错误。

产物两端各取所需：Web 侧替身组件 `import('fjs/data/icons.json')`，打包器切成单独
chunk（页面不画图标就不下载）；App 侧由 fjs 拷进 Flutter 宿主 assets，Dart 读
`assets/fjs/modules/iconmind/icons.json`。

**产物里只有页面真的写了的那几个图标**——2,437 个里用了 6 个就带 6 个（约 1 KB），
和上游包的 tree-shaking 是一个效果，但 app 不用维护清单。

### 名字来自数据时

扫描只能看见字面量。名字是接口返回、路由参数拼出来的，放项目根的
`iconmind.json`：

```json
{ "icons": ["rag-pipeline", "shield-ellipsis"] }
```

这是模块自己的配置文件，只在需要时出现，不占 app 的 package.json。

写了一个不存在的 slug，构建会当场停下并提示相近的名字，而不是在界面上留一块
空白。

## 一个图标就两个字段

`[路径, 是否闭合]`。几何是权重无关的（一个 weight 就是一个 stroke width），
duotone 由 `closed` 推出来：闭合形状铺 20% 填充，开放形状加 20% 的 halo。两端
照同样两条规则画，所以天然一致。

## props

| prop | 默认 | 说明 |
|------|------|------|
| `name` | — | [iconmind.dev/icons](https://iconmind.dev/icons) 上的 slug |
| `size` | 24 | 逻辑像素 |
| `color` | 主题色 / `currentColor` | `#rgb` / `#rrggbb` / `#aarrggbb` |
| `variant` | `outline` | `outline` \| `duotone` |
| `weight` | `regular` | `thin` \| `regular` \| `bold` |
| `@tap` | — | App 上来自 widget 的 dispatch，Web 上由替身组件转发 |

`name` 的类型来自钩子生成的 `interface FjsIcons`（和路由名的 `FjsRoutes` 同一个
套路）。还没生成过时它是空的，`IconName` 退回 `string`，一样能用。名字来自数据
时照常 `as IconName`。

## Flutter 侧

`flutter/` 是 Dart 包 `fjs_iconmind`，注册 `<icon-mind />` 这个标签，外加两个
调试用的 host 函数（`iconmind.count` / `iconmind.has`）。fjs 生成 Flutter 宿主时
自动加依赖、注册调用和 asset（autolink），不用手改 `pubspec.yaml` 或 `main.dart`。
