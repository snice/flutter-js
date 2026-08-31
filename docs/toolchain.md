# 工具链：创建、运行、测试、编译

`@ufjs/cli` 提供 `fjs` 命令。主路径是：

```bash
npx @ufjs/cli create my-app
cd my-app
npm install
npm run dev:web
npm run dev:pages
npm run run:android
npm run build:release
```

## 准备环境

分两种情况，除了依赖来源不同，之后所有 `fjs` 子命令完全一样。

### A. 用发布包做应用

装 CLI 就够了，**不需要 CMake、NDK 或克隆本仓库**：

```bash
npx @ufjs/cli create my-app && cd my-app && npm install
```

- `flutter_fjs` 由 `fjs run` 生成的 Flutter 宿主从 pub.dev 拉，里面带了预编译的
  `libfjs.so` 和 `fjs.xcframework`
- 字节码编译器 `fjsc` 是 `@ufjs/cli` 的可选依赖 `@ufjs/fjsc-<平台>`，按 `os`/`cpu`
  自动装匹配的那个

装完发现 `--bytecode` 报「fjsc not found」，多半是发布窗口期的 npm 缓存问题——
optional 依赖解析失败是静默的。`npm cache clean --force` 后重装。

### B. 在本仓库开发

```bash
pnpm install
```

workspace 会把 `demo`、`examples/*` 链到 `packages/fjs` 和 `packages/fjs-runtime`
的源码；Flutter 侧走 `packages/flutter_fjs` 的 path 依赖。

`fjsc` 自己编一次，它必须和 Flutter 插件内嵌的 QuickJS-ng 来自同一份源码：

```bash
cd packages/flutter_fjs/native
cmake -B build-native -DFJS_BUILD_TESTS=ON
cmake --build build-native -j
./build-native/fjs-test
```

### fjsc 的查找顺序

`fjs build --bytecode` 按这个顺序找：

1. 环境变量 `FJSC_PATH`
2. 仓库内 `packages/flutter_fjs/native/build-native/fjsc`
3. npm 包 `@ufjs/fjsc-<平台>`

**仓库自编排在 npm 包前面**是刻意的：`pnpm install` 也会把 npm 包拉进 workspace，
如果它赢了，改完 `native/` 的人就会继续用已发布的旧引擎编字节码。第 2 条路径从
`node_modules` 里匹配不到，所以装到用户项目里仍然走第 3 条。

## 创建项目

```bash
npx @ufjs/cli create my-app        # A
pnpm exec fjs create my-app        # B，工作区已 link
```

默认模板是 `vue3-vite`。模板会生成标准 Vite 项目，并带上 fjs 需要的页面目录：

```text
my-app/
  index.html
  vite.config.ts
  package.json
  src/
    main.ts
    Shell.vue
    pages/
      index.vue
```

首页是 `src/pages/index.vue`，默认文本为 `hello-fjs`。`src/pages` 是必须目录，
路由表由它自动生成。

本仓库内置的 `demo` 已改成 `workspace:*` 依赖，适合验证当前 checkout 的 CLI 和
runtime：

```bash
pnpm --filter demo run typecheck
pnpm --filter demo run build:release
```

常用创建参数：

| 参数 | 说明 |
|------|------|
| `--template <name>` | 指定模板，当前默认 `vue3-vite` |
| `--list-templates` | 查看可用模板 |
| `--name <name>` | 指定 package name |
| `--yes` | 使用默认值，跳过交互 |

当前模板：

| 模板 | 说明 |
|------|------|
| `vue3-vite` | 默认模板，Vue 3 + Vite + `src/pages` 路由 |
| `ts` | 纯 TypeScript + element API，单包 release，模板列表中放在最后 |

后续扩展 React 等模板时，只需要往 create 的模板注册表里增加新模板。

## 在已有项目里生成文件

`fjs create` 的第一个参数如果是 `page` / `component`，它生成的是文件而不是项目。
`fjs g` 是只做生成的别名。

```bash
fjs create page about --title 关于       # src/pages/about.vue        -> /about
fjs create page user/[id]               # src/pages/user/[id].vue    -> /user/:id
fjs g page settings --platform app      # 只在 App 端出现的页面
fjs create component FancyButton        # src/components/FancyButton.vue
```

| 参数 | 说明 |
|------|------|
| `--title <text>` | 写进 `<route>` 块的标题 |
| `--tab <n>` | 写进 `<route>` 块的 tab 序号 |
| `--path <route>` | 覆盖由文件名推导的路由路径 |
| `--route-name <name>` | 覆盖由路径推导的路由名 |
| `--platform <app\|web>` | 限定平台，缺省两端都有 |
| `--dry-run` / `-n` | 只打印将写入的内容 |
| `--force` / `-f` | 覆盖已存在的文件 |

页面名可以嵌套（`comp/button`）也可以是动态段（`[id]` / `[...rest]`）；带动态段
时模板会顺手写好 `useRoute()` 和参数展示。生成器写完文件后，会用**构建期同一个
扫描器**重新解析一遍并打印实际路由，所以打印出来的就是 `fjs build` 看到的。

同时它会把路由表写成 `src/fjs-routes.d.ts`（`fjs build` / `fjs dev` / Vite 插件
也会写），`router.push({ name })` 因此有补全和拼写检查，详见
[路由](routing.md#路由名的类型提示)。

## 查看路由表

```bash
fjs routes                  # PATH / NAME / CHUNK / TARGET / FILE / META
fjs routes --platform web   # 只看 web 端会包含的页面
fjs routes --json
```

同一路径被两个文件命中时会给出告警——文件路由最常见的坑就是这个。

## 体检

```bash
fjs doctor
```

依次检查 Node 版本、是不是 fjs 项目、入口与 `src/pages`、`@ufjs/cli` 与
`@ufjs/runtime` 是否同一 minor、fjsc 从哪来（`FJSC_PATH` / npm / 本地构建）、
`flutter`、`adb`、`xcodebuild`、可用的 android/ios 设备，以及 `.fjs/flutter`
宿主的 `flutter_fjs` 是 path 依赖还是 pub.dev。只影响部分目标的问题算 warning，
真正会挡住构建的算 problem 并让退出码为 1。

## 开发运行

### 浏览器

```bash
pnpm run dev:web
```

模板里的 `dev:web` 走 Vite，适合快速开发 UI 和业务逻辑。

### Android / iOS

推荐先用 [fjs go](fjs-go.md)：装一次调试客户端后，项目侧只需要启动
`pnpm run dev:pages`，然后在 fjs go 里扫码、选择附近服务器或手输地址。Android
的 APK 可以从
[Release 页](https://github.com/snice/flutter-js/releases/latest) 直接下，不用
自己编。

```bash
pnpm run run:android
pnpm run run:ios
```

等价于：

```bash
fjs run android
fjs run ios
fjs run android --release --minify --gz
```

`fjs run` 会创建或复用 `.fjs/flutter`。这个 Flutter 宿主由 CLI 生成，包含：

- `flutter_fjs` 依赖
- `FjsEngine` 初始化
- dev 模式连接 `FJS_DEV`
- release 模式加载 `assets/fjs/*.fjsbundle`

运行时流程：

1. 确认 `.fjs/flutter` 存在，不存在就执行 `flutter create`
2. 写入生成版 `pubspec.yaml` 和 `lib/main.dart`
3. 执行 `flutter pub get`
4. 启动 `fjs dev --pages`
5. 执行 `flutter run -d android|ios --dart-define=FJS_DEV=<host:port>`

常用参数：

```bash
fjs run ios --device <device-id>
fjs run android --port 38913
fjs run android -- --debug
fjs run android --release --minify --gz
```

默认 `fjs run` 会启动 dev server 并通过 `FJS_DEV` 连接宿主。加 `--release` 后不启
动 dev server，而是先同步 release assets，再执行 `flutter run --release`。
`--release` 默认使用 pages split；纯 TS 单包项目可加 `--no-pages`。`--minify` 只
压缩 JS，`--gz` 只压缩同步到 Flutter assets 的 `.fjsbundle`。

`--` 后面的参数会原样传给 `flutter run`。

## 测试

### A：在你的项目里

```bash
npm run typecheck
npm run build
npm run build:web
```

生成 Flutter 宿主后：

```bash
cd .fjs/flutter
flutter analyze
```

### B：在本仓库

```bash
pnpm run typecheck                  # 全 workspace
pnpm test                           # @ufjs/runtime 单测
pnpm run build

cd packages/flutter_fjs && flutter test
cd examples/fjs-go && flutter test
```

`packages/flutter_fjs/test/nav_router_test.dart` 和 fjs-go 的集成测试要用
`native/build-native/libfjs.dylib` 起真实 VM，**找不到就整个文件静默跳过**
（输出是 `No tests ran`，不是失败）。先 `cmake --build build-native` 再跑。

完整验证 demo：

```bash
pnpm --filter demo run typecheck
pnpm --filter demo run build:web
pnpm --filter demo run build:release
pnpm --filter demo run build:apk -- --debug
```

## 编译模式

| 命令 | 产物 | 用途 |
|------|------|------|
| `fjs build` | `dist/bundle.js` | 单包源码构建 |
| `fjs build --bytecode` | `dist/bundle.js` + `dist/app.fjsbundle` | 单包字节码 |
| `fjs build --pages` | `dist/shared.js`、`dist/bundle.js`、`dist/pages/*.js` | App 分页加载 |
| `fjs build --web` | `dist/web` | CLI 内置 Web 静态构建 |
| `fjs build --release` | 单包 `.fjsbundle` + Flutter assets | 纯 TS 发布构建 |
| `fjs build --pages --release` | split `.fjsbundle` + Flutter assets | Vue pages 发布构建 |
| `fjs build --release --apk` | release assets + APK | 纯 TS Android 打包 |
| `fjs build --pages --release --apk` | release assets + APK | Vue pages Android 打包 |

`--web` 和 `--pages` 互斥。

默认 Vue3+Vite 模板的 `pnpm run build:web` 直接执行 `vite build`，Web 产物在
`dist/`；上表里的 `fjs build --web` 是 CLI 内置 Web 构建模式，产物在
`dist/web/`。

## Release 构建

推荐发布命令：

```bash
fjs build --release          # 纯 TS / 单包项目
fjs build --pages --release  # Vue pages 项目
```

它会自动打开 `--bytecode`，并同步 release assets。非 web 构建不会默认压缩 JS
和 `manifest.json`，也不会默认 gzip release assets；如果希望 bytecode 来自
minified JS 且 manifest 紧凑输出，需要显式加 `--minify`；如果希望同步
`.fjsbundle.gz`，需要显式加 `--gz`：

```bash
fjs build --release --minify --gz
fjs build --pages --release --minify --gz
```

并同步到 Flutter 宿主：

```text
.fjs/flutter/assets/fjs/
  manifest.json
  bundle.fjsbundle
  shared.fjsbundle      # 仅 --pages
  pages/
    index.fjsbundle     # 仅 --pages
```

生成的 `.fjs/flutter/lib/main.dart` 启动时会先判断 `FJS_DEV`：

- 有 `FJS_DEV`：连接 dev server
- 没有 `FJS_DEV`：按 manifest 加载 `assets/fjs` 下的 release assets；如果是
  `.fjsbundle.gz` 会自动解压后执行

`dist/*.fjsbundle` 仍是未压缩 QuickJS bytecode，方便直接用 `fjsrun` 验证；gzip
只发生在 `--release --gz` 同步到 Flutter assets 的发布文件上。

## APK

```bash
fjs build --release --apk
fjs build --pages --release --apk
```

`--apk` 必须和 `--release` 一起使用。Flutter build 参数写在 `--` 后：

```bash
fjs build --release --apk -- --debug
fjs build --pages --release --apk -- --debug
fjs build --pages --release --apk -- --target-platform android-arm64
```

APK 输出目录：

```text
.fjs/flutter/build/app/outputs/flutter-apk/
```

## dev server

```bash
fjs dev --pages
```

dev server 默认端口 `38900`，会提供：

- `/manifest.json`
- `/shared.js`
- `/bundle.js`
- `/pages/<chunk>.js`
- `/ws` 热重载通道

`fjs run` 会自动启动这个 server。手动连接 Flutter 宿主时可以使用：

```dart
final engine = FjsEngine();
await engine.connectDev('192.168.x.x', 38900);
```

## 字节码格式

`.fjsbundle` 是带头部的 QuickJS 字节码：

```text
[0..4)   magic "FJSB"
[4..6)   u16 format version = 1
[6..8)   u16 engine id length
[8..]    engine id + QuickJS bytecode
```

App 加载时会校验 magic、格式版本和 engine id；QuickJS 或 `fjsc` 版本不一致时会
直接报错，避免运行期出现难定位的崩溃。

`--release --gz` 的 assets 保存为 `.fjsbundle.gz`。Flutter 侧先 gunzip，再按
上面的 `.fjsbundle` 格式校验和执行；未压缩 assets 也可被加载。

## 常见问题

**`fjs: command not found`**

还没安装工作区依赖。先在仓库根执行 `pnpm install`。项目外要全局使用，可以在
`packages/fjs` 执行 `pnpm link --global`。

**`fjsc compiler not found`**

先构建 `packages/flutter_fjs/native/build-native/fjsc`，或设置 `FJSC_PATH`。

**Flutter SDK cache lockfile 权限错误**

这是 Flutter/FVM 安装目录权限问题，不是 fjs 构建问题。修复 SDK 目录权限后重跑
命令。

**Android 构建 Java 版本异常**

Flutter 和直接 gradle 使用的 JDK 可能不同。可指定 JDK 21：

```bash
flutter config --jdk-dir=$(/usr/libexec/java_home -v 21)
cd android
./gradlew --stop
```

## 相关

- [分包与 release assets](code-splitting.md)
- [路由](routing.md)
- [Web 平台](web.md)
- [Vue 3 集成](vue3.md)
