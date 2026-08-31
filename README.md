# flutter-js

**用 JS/TS 和 Vue 3 开发 Flutter 应用。**

flutter-js 把 JS 引擎嵌入 Flutter，用 npm/Vite 写业务界面，用 Flutter 负责原生
渲染、路由栈、手势和打包。默认项目是标准 **Vue 3 + Vite**，同时可以跑浏览器、
Android、iOS，并支持 release 字节码包。

```
Vue 3 / TypeScript / Vite
        │
        ▼
fjs CLI: create / dev / run / build
        │
        ▼
@ufjs/runtime: UI 标签、路由、Vue renderer、样式引擎
        │
        ▼
flutter_fjs: QuickJS-ng + Dart FFI + Flutter Widget
```

## 两种用法，先分清你在哪一边

| | **A. 用发布包做应用** | **B. 在本仓库改 flutter-js 自身** |
|---|---|---|
| 适用于 | 绝大多数人 | 要改引擎、运行时或 CLI |
| 工具链 | npm 上的 `@ufjs/cli` + `@ufjs/runtime` | pnpm workspace 里的源码 |
| Flutter 插件 | pub.dev 上的 `flutter_fjs`（含预编译原生产物） | `packages/flutter_fjs` 的 path 依赖 |
| `fjsc` 字节码编译器 | 随 `@ufjs/cli` 自动装（`@ufjs/fjsc-<平台>`） | 自己 cmake 编一次，会**优先于** npm 包 |
| 需要 CMake / NDK / Xcode | **不需要** | 改 `native/` 时需要 |
| 起步命令 | `npx @ufjs/cli create my-app` | `pnpm install` + 用内置 `demo` |

两边的项目结构和所有 `fjs` 子命令完全一样，区别只在依赖从哪来。下面 A、B 分开写。

---

# A. 用发布包做应用

## 1. 创建项目并启动 dev server

```bash
npx @ufjs/cli create my-app
cd my-app
npm install
npm run dev:pages
```

不需要克隆本仓库，也不需要任何原生工具链：`flutter_fjs` 从 pub.dev 装，里面已经
带了预编译的 `.so` 和 `.xcframework`；字节码编译器 `fjsc` 作为
`@ufjs/cli` 的可选依赖按平台自动装。

默认模板是 `vue3-vite`。它会生成标准 Vite 入口和必须的 `src/pages` 目录：

```text
src/
  main.ts
  Shell.vue
  pages/
    index.vue    # 首页文本就是项目名
```

当前模板包括默认的 `vue3-vite` 和纯 TS 模板 `ts`。模板可扩展，可用模板通过下面
命令查看：

```bash
npx fjs create --list-templates
```

## 2. 用 fjs-go 在手机上调试

**fjs-go 是推荐的快速入门调试客户端**：Android/iOS 设备上装一次，之后连接任意
`fjs dev` 项目。改 JS/Vue 只需要 dev server 重载，不需要重新打原生包。

**Android 直接下 APK 装**——[Releases](https://github.com/snice/flutter-js/releases/latest)
里每个版本都带两个包：

| 下载 | 大小 | 用途 |
|------|------|------|
| [fjs-go-release-arm64.apk](https://github.com/snice/flutter-js/releases/latest/download/fjs-go-release-arm64.apk) | ~8.7 MB | 日常调试用这个 |
| [fjs-go-debug-arm64.apk](https://github.com/snice/flutter-js/releases/latest/download/fjs-go-debug-arm64.apk) | ~42 MB | 需要 Flutter DevTools 时用 |

两个都只打 `arm64-v8a`（覆盖近几年的机器），用同一个 fjs-go 测试证书签名，所以
可以直接覆盖升级。装之前在系统里允许一次「安装未知来源应用」。

iOS 暂时没有分发包，需要自己跑 `flutter run`。

本地也可以直接运行：

```bash
cd examples/fjs-go
flutter run
```

连接方式：

- 真机：扫 `fjs dev` 输出的二维码，或点“附近的 dev 服务器”
- Android 模拟器：填 `10.0.2.2:38900`
- iOS 模拟器 / macOS：填 `127.0.0.1:38900`

更多细节见 [docs/fjs-go.md](docs/fjs-go.md)。

## 3. 浏览器开发

```bash
npm run dev:web
```

这是普通 Vite dev server，适合快速调样式和业务逻辑。

## 4. 直接跑到 Android / iOS

```bash
npm run run:android
npm run run:ios
```

`fjs run` 会自动：

- 在当前项目创建或复用 `.fjs/flutter`
- 启动 `fjs dev --pages`
- 通过 `FJS_DEV` 把 dev server 地址注入 `flutter run`

可以透传 Flutter 参数：

```bash
npx fjs run ios --device <device-id>
npx fjs run android -- --debug
npx fjs run android --release --minify --gz
```

## 5. 测试

```bash
npm run typecheck
```

Flutter 宿主生成后也可以检查：

```bash
cd .fjs/flutter
flutter analyze
```

## 6. 编译发布

```bash
npm run build:release
```

等价于：

```bash
fjs build --pages --release
```

它会生成 split bytecode，并自动复制到 Flutter 宿主 assets：

```text
.fjs/flutter/assets/fjs/
  manifest.json
  shared.fjsbundle
  bundle.fjsbundle
  pages/
    index.fjsbundle
```

需要压缩 JS 和 `manifest.json` 时显式加 `--minify`；需要 gzip release assets 时
显式加 `--gz`。这时同步到 Flutter assets 的是 `.fjsbundle.gz`，生成的 Flutter
宿主启动时会自动解压后交给 QuickJS。`dist/*.fjsbundle` 始终保留未压缩版本，方便
本地 `fjsrun` 验证。

需要直接打 Android APK：

```bash
npm run build:apk
```

等价于：

```bash
fjs build --pages --release --apk
```

传 Flutter build 参数放在 `--` 后面：

```bash
fjs build --pages --release --apk -- --debug
```

APK 输出目录：

```text
.fjs/flutter/build/app/outputs/flutter-apk/
```

---

# B. 在本仓库改 flutter-js 自身

只有要动引擎、运行时或 CLI 时才需要这一节。做应用的话上面 A 就够了。

## 环境准备

```bash
git clone https://github.com/snice/flutter-js && cd flutter-js
pnpm install
```

`pnpm install` 会把 `demo` 和 `examples/*` 用 workspace 链接到 `packages/fjs`
和 `packages/fjs-runtime` 的源码，改完立刻生效，不走 npm。

字节码构建要用 `fjsc`。仓库里自己编一次：

```bash
cd packages/flutter_fjs/native
cmake -B build-native -DFJS_BUILD_TESTS=ON
cmake --build build-native -j
./build-native/fjs-test
```

**仓库里自编的 `fjsc` 会优先于 npm 上的 `@ufjs/fjsc-<平台>`**，即使
`pnpm install` 把后者也拉了下来。这是刻意的：否则改完 `native/` 之后，字节码还
是用已发布的旧引擎编的。改过 `native/` 就重新 `cmake --build` 一次。

## 用内置 demo 验证

`demo` 和 `examples/hello-fjs` 已配好 workspace 依赖，是验证当前源码的最快路径：

```bash
pnpm --filter demo run typecheck
pnpm --filter demo run build:release
pnpm --filter demo run build:apk -- --debug

pnpm --filter hello-fjs run build:pages   # 组件画廊，同源跑 Flutter 和 Web
```

## 跑测试

```bash
pnpm run typecheck                  # 全 workspace
pnpm test                           # @ufjs/runtime 单测

cd packages/flutter_fjs && flutter test
cd examples/fjs-go && flutter test
```

`packages/flutter_fjs/test/nav_router_test.dart` 和 fjs-go 的集成测试要用上面那个
host dylib 起真实 VM，**找不到就整个文件静默跳过**（输出是 `No tests ran`，不是
失败）。所以先 `cmake --build build-native` 再跑 `flutter test`。

## 改了原生代码

`packages/flutter_fjs/native/` 改动后，随包发布的预编译产物要重新生成并提交，
见下面「[发布产物](#发布产物)」。完整发布流程见
[docs/publishing.md](docs/publishing.md)。

---

## 仓库结构

| 路径 | 说明 |
|------|------|
| `packages/fjs` | npm 包 `@ufjs/cli`：`create`、`dev`、`run`、`build`、Vite 插件 |
| `packages/fjs-runtime` | npm 包 `@ufjs/runtime`：UI 标签、路由、Vue renderer、样式引擎 |
| `packages/flutter_fjs` | pub 包 `flutter_fjs`：QuickJS-ng、Dart FFI、Widget 渲染层 |
| `demo` | 当前标准 Vue3+Vite demo，用于从 create 到 run/build 的完整验证 |
| `examples/hello-js` | 底层 element API 示例 |
| `examples/hello-fjs` | Vue3 组件画廊示例，同一份源码跑 Flutter 和 Web |
| `examples/fjs-go` | 推荐调试客户端，装一次后连接任意 `fjs dev` 项目 |
| `docs` | 更完整的架构、工具链、路由、Web、Vue、分包和性能文档 |

JS 侧使用 pnpm workspace；Flutter 插件和 Flutter 示例走 pub。

## 发布产物

`flutter_fjs` 把原生引擎**预编译**后随包发布，接入方不需要 NDK、CMake 或任何
原生编译步骤：

| 平台 | 产物 |
|------|------|
| Android | `android/src/main/jniLibs/{armeabi-v7a,arm64-v8a,x86_64}/libfjs.so` |
| iOS / macOS | `ios/fjs.xcframework`、`macos/fjs.xcframework`（静态切片，链进 App 二进制）|

改了 `packages/flutter_fjs/native/` 之后重新生成并提交：

```bash
cd packages/flutter_fjs
ANDROID_NDK_HOME=... tool/build-android.sh
tool/build-apple.sh   # 需要 macOS + Xcode
```

## 常用命令

| 命令 | 用途 |
|------|------|
| `fjs create <dir>` | 创建项目，默认 `vue3-vite` |
| `fjs create <dir> --template ts` | 创建纯 TypeScript + element API 项目 |
| `fjs dev --pages` | 启动 App 端 dev server |
| `fjs run android` | 创建/复用 Flutter 宿主并运行 Android dev 模式 |
| `fjs run android --release` | 构建 release assets 并运行 Android release 模式 |
| `fjs run ios` | 创建/复用 Flutter 宿主并运行 iOS |
| `fjs build` | 单包 JS 构建 |
| `fjs build --bytecode` | 单包 QuickJS 字节码构建 |
| `fjs build --web` | Web 静态构建 |
| `fjs build --release` | 单包发布构建，同步 `.fjsbundle` 到 Flutter assets |
| `fjs build --pages --release` | pages 发布构建，同步 split `.fjsbundle` 到 Flutter assets |
| `fjs build --release --apk` | 同步 assets 后执行 `flutter build apk` |

## 文档

- [文档入口](docs/README.md)
- [工具链与创建/运行/测试/编译](docs/toolchain.md)
- [fjs go 调试客户端](docs/fjs-go.md)
- [路由](docs/routing.md)
- [Web 平台](docs/web.md)
- [Vue 3 集成](docs/vue3.md)
- [分包与 release assets](docs/code-splitting.md)
- [发布 npm 与 pub.dev](docs/publishing.md)
- [UI API](docs/ui-api.md)
- [架构与线程模型](docs/architecture.md)
- [JSI 与原生模块](docs/jsi-and-native-modules.md)
- [性能测试](docs/performance.md)
- [Roadmap](docs/roadmap.md)

## License

MIT
