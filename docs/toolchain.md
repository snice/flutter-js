# 工具链：创建、运行、测试、编译

`packages/fjs` 提供 `fjs` CLI。主路径是：

```bash
fjs create my-app
cd my-app
pnpm install
pnpm run dev:web
pnpm run dev:pages
pnpm run run:android
pnpm run build:release
```

## 准备环境

仓库根目录安装 JS 依赖：

```bash
pnpm install
```

release 和 bytecode 构建需要 `fjsc`。它必须和 Flutter 插件内嵌的 QuickJS-ng
来自同一份源码：

```bash
cd packages/flutter_jsc/native
cmake -B build-native -DFJS_BUILD_TESTS=ON
cmake --build build-native -j
./build-native/fjs-test
```

`fjs build --bytecode` 会按顺序查找：

- 环境变量 `FJSC_PATH`
- 仓库内 `packages/flutter_jsc/native/build-native/fjsc`
- PATH 里的 `fjsc`

## 创建项目

发布包可用或已全局 link `fjs` 后：

```bash
pnpm exec fjs create my-app
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

## 开发运行

### 浏览器

```bash
pnpm run dev:web
```

模板里的 `dev:web` 走 Vite，适合快速开发 UI 和业务逻辑。

### Android / iOS

推荐先用 [fjs go](fjs-go.md)：装一次调试客户端后，项目侧只需要启动
`pnpm run dev:pages`，然后在 fjs go 里扫码、选择附近服务器或手输地址。

```bash
pnpm run run:android
pnpm run run:ios
```

等价于：

```bash
fjs run android
fjs run ios
```

`fjs run` 会创建或复用 `.fjs/flutter`。这个 Flutter 宿主由 CLI 生成，包含：

- `flutter_jsc` 依赖
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
```

`--` 后面的参数会原样传给 `flutter run`。

## 测试

项目内：

```bash
pnpm run typecheck
pnpm run build
pnpm run build:web
```

生成 Flutter 宿主后：

```bash
cd .fjs/flutter
flutter analyze
```

仓库根：

```bash
pnpm run typecheck
pnpm test
pnpm run build
```

如果要完整验证 demo：

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

它会自动打开：

- `--bytecode`
- `--minify`

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
- 没有 `FJS_DEV`：加载 `assets/fjs` 下的 release assets

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

## 常见问题

**`fjs: command not found`**

还没安装工作区依赖。先在仓库根执行 `pnpm install`。项目外要全局使用，可以在
`packages/fjs` 执行 `pnpm link --global`。

**`fjsc compiler not found`**

先构建 `packages/flutter_jsc/native/build-native/fjsc`，或设置 `FJSC_PATH`。

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
