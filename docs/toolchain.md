# 工具链：创建、运行、测试、编译

> 第四层。全部 `fjs` 命令。仓库自身的包管理规范在
> [monorepo.md](monorepo.md)。

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

`fjs create` 的第一个参数如果是 `page` / `component` / `module`，它生成的是文件
而不是项目。`fjs g` 是只做生成的别名。

```bash
fjs create page about --title 关于       # src/pages/about.vue        -> /about
fjs create page user/[id]               # src/pages/user/[id].vue    -> /user/:id
fjs g page settings --platform app      # 只在 App 端出现的页面
fjs create component FancyButton        # src/components/FancyButton.vue
fjs create module qrcode --flutter      # src/modules/qrcode：可发 npm 的模块
```

`module` 生成的是一个自带 package.json 的包：API 在 `index.ts`（`import { … }
from 'qrcode'`），组件在 `components/`（`<QrcodeView />` 直接用，不用 import），
`--flutter` 还会生成 Dart 侧并写好 autolink 清单。发到 npm 之后别人装上即用，
细节见[模块](modules.md)。

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

## 添加三方库

```bash
fjs add pinia               # 装包 + 写插件文件 + 接进入口
fjs add dayjs mitt          # 只动 package.json
fjs add --list              # 支持哪些
fjs add pinia --dry-run     # 只打印要改什么
```

registry 里每个条目分两类，这是这个命令存在的全部理由：

| kind | 改什么 | 例子 |
|------|--------|------|
| `dep` | 只有 `package.json` | dayjs、mitt、valibot、immer、es-toolkit |
| `plugin` | `package.json` + `src/plugins/<name>.ts` + 入口（仅第一次） | pinia、vue-i18n |

`plugin` 类需要 `app.use()`。它写出的文件默认导出 `(app) => void`，`fjs build` /
`fjs dev` / Vite 插件会把 `src/plugins/*.ts` 收集成生成模块 `fjs/plugins`——和
`fjs/pages` 收集路由表是同一套机制。入口只在**第一次**装 `plugin` 类库时被改一行：

```ts
import { plugins } from 'fjs/plugins';

createFjsApp({ routes, plugins, shell: Shell }).mount();
```

之后再 `fjs add`，命令看到这个 import 就不再动入口。新建项目的模板自带这一行，
所以对新项目来说入口永远不用改。

插件文件支持 `.app.ts` / `.web.ts` 后缀限定平台，加载顺序按文件名字典序，需要抢先
的用 `10-` 这样的前缀。

### 一个要记住的坑

Flutter 端**每个页面是独立的 Vue app**，所以插件函数每页跑一次。必须跨页共享的
东西（Pinia 实例、i18n 实例）要写在插件文件的**模块作用域**，不能建在导出的函数
里，否则每页各拿一套 store：

```ts
const pinia = createPinia();          // 模块作用域：全 app 一个
export default (app: App) => app.use(pinia);
```

`fjs add pinia` 生成的文件已经是这个形状。`fjs build --pages` 下 `fjs/plugins` 走
共享 chunk，页面 chunk 通过 `__FJS_SHARED` 引用同一个 store 模块。

### 共享 chunk：`fjs.shared`

`fjs build --pages` 会把 vue / fjs 运行时放进 `shared.js`，页面 chunk 通过
`__FJS_SHARED` 引用，不各带一份。第三方库默认**不在**这个名单里——页面 chunk 里
直接 `import { storeToRefs } from 'pinia'` 就会被 esbuild 复制一份进那个 chunk。

这不只是体积问题：两份 pinia 就是两个 `activePinia` 模块变量，页面 chunk 里读到的
会是另一个 store。所以带模块级状态的库要登记到 package.json：

```json
{
  "fjs": {
    "shared": ["pinia"]
  }
}
```

`fjs add` 对 registry 里声明了 `shared` 的条目会自动写这一项。手动加时判断标准是：
**页面 chunk 会直接 import 它，并且它有模块级状态**（pinia、vue-i18n）。纯函数库
（dayjs、es-toolkit）不需要，多一份副本只是多几 KB。

demo 里实测：about 页加一行 `storeToRefs` 后，`dist/pages/about.js` 从 1738 B 涨到
4707 B；登记 `fjs.shared` 后回到 1848 B，`shared.js` 只多 1.6 KB。

### 和 `fjs native add` 的分界

`fjs add` 只动 JS 侧。要动 Flutter 宿主（pubspec 插件、Dart 注册、权限清单）的原生
能力归 `fjs native add <capability>`（见 [roadmap](roadmap.md)），它们生命周期不同：
原生能力要能 list/remove/sync 对着可 eject 的宿主收敛。JS 库用 registry 里的
`requires` 声明依赖哪个 capability，缺了就提示先装它，而不是等到运行时报错。

## 查看路由表

```bash
fjs routes                  # PATH / NAME / CHUNK / TARGET / FILE / META
fjs routes --platform web   # 只看 web 端会包含的页面
fjs routes --json
```

同一路径被两个文件命中时会给出告警——文件路由最常见的坑就是这个。

## Flutter 宿主

默认宿主在 `.fjs/flutter`：被 gitignore，每次 `fjs run` 都会重新生成
`lib/main.dart` 和 `pubspec.yaml`。这个默认适合「界面全用 JS 写」的阶段。

### 原生应用配置

在项目根目录创建 `app.config.ts`（与 `package.json` 同级），为自动生成的
`.fjs/flutter` 配置 Android/iOS 包名和权限：

```ts
import { defineConfig } from '@ufjs/cli/config';

export default defineConfig({
  android: {
    applicationId: 'com.acme.demo',
    permissions: [
      'android.permission.INTERNET',
      'android.permission.ACCESS_NETWORK_STATE',
    ],
  },
  ios: {
    bundleIdentifier: 'com.acme.demo',
    infoPlist: {
      NSCameraUsageDescription: '用于扫描二维码',
      NSLocalNetworkUsageDescription: '用于连接开发服务器',
    },
  },
});
```

从 `@ufjs/cli/config` 导入 `defineConfig` 后，编辑器会提示
`applicationId`、`permissions`、`bundleIdentifier` 和 `infoPlist` 的类型。
也可以只导入 `AppConfig`，用 `satisfies AppConfig` 做类型检查。

`fjs host create` 和 `fjs run` 会把这些配置同步到 managed Flutter 宿主：

- Android 的 `applicationId` 和 `android/app/src/main/AndroidManifest.xml` 权限；
- iOS 的 `PRODUCT_BUNDLE_IDENTIFIER` 和 `ios/Runner/Info.plist` 键值。

配置只覆盖 FJS 写入的标记区块，重复运行不会重复添加。没有配置的字段保持
Flutter 默认值。Android 权限写完整的 permission name；iOS 的 `infoPlist` 键名
就是 Apple 的 Info.plist key，例如 `NSCameraUsageDescription`。

`fjs host id <id>` 仍可用于一次性修改已有宿主；要让 managed 宿主在重新生成后
保持包名，应把 `applicationId` / `bundleIdentifier` 写入 `app.config.ts`。

```bash
fjs host                     # 在哪、归谁管、application id、flutter_fjs 从哪来
fjs host create              # 只创建/更新宿主，不跑应用
fjs host open android|ios    # 用 Android Studio / Xcode 打开
fjs host id                  # 打印当前 application id
fjs host id com.acme.app     # 改 applicationId 和 bundle identifier
fjs host eject [dir]         # 移进仓库（默认 flutter/），从此归你管
fjs host sync --force        # 把生成版宿主文件重新盖回去
```

### eject 之后

一旦要加权限、加原生插件、配签名、换图标，就 `fjs host eject`。它做三件事：

1. 把 `.fjs/flutter` 移到 `flutter/`（或你指定的目录）
2. 往 `package.json` 写 `fjs.flutterDir`，之后所有命令都认这个目录
3. 从此**不再改写**它的 `lib/main.dart`、`pubspec.yaml` 和 Gradle 补丁

`fjs run` 仍然会保证 `assets/fjs` 目录存在并执行 `pub get`，其余交给你。
`fjs clean --all` 会拒绝删除 eject 过的宿主——那已经是你的源码，不是构建产物。
想拿回生成版本用 `fjs host sync --force`。

### application id

```bash
fjs host id com.acme.app
```

只改 Android 的 `applicationId` 和 iOS 的 `PRODUCT_BUNDLE_IDENTIFIER`（含
`RunnerTests` 那几个）。Gradle 的 `namespace` **不动**：它是生成的 R / BuildConfig
类的包名，改了就得连 `MainActivity.kt` 一起搬。`--dry-run` 可以先看会改哪些文件。

## 应用图标

```bash
fjs icon icon.png              # 覆盖 Android mipmap + iOS appiconset
fjs icon icon.png --dry-run    # 只列出会写哪些文件、各是多大
fjs icon icon.png --platform ios
```

源图给一张方形 PNG，1024x1024 最稳（iOS 最大就要这个尺寸）。命令**就地覆盖**
`flutter create` 留下的那些文件，所以不用注册任何东西：Android 五档 mipmap
（48/72/96/144/192）按目录写回，iOS 的尺寸直接从 `AppIcon.appiconset` 里已有的文件
名反推（`Icon-App-83.5x83.5@2x.png` → 167），`Contents.json` 原样不动。

缩放本身调用系统已有的工具，不引入图像依赖：macOS 用自带的 `sips`，其他平台找
`magick` / `convert`，都没有会报错说明装哪个。

写之前会读 PNG 的 IHDR 做三件事：确认真的是 PNG（否则十几个文件都会写坏才发现）、
非方形给警告（会被拉伸而不是裁剪）、带 alpha 通道时提醒——iOS 图标必须不透明，
App Store Connect 会因为透明度打回。

## 看日志 / 在设备上求值

```bash
fjs log                          # 应用的 console 输出，实时
fjs eval '1 + 1'                 # 在正在跑的 VM 里求值
fjs eval 'Object.keys(globalThis).length' --timeout 10000
fjs log --port 38913             # dev server 不在默认端口时
```

日志按 JS console 的级别分档并显示名字（`debug` / `info` / `warn` / `error`），
取值和引擎原生的 `FJS_LOG_*` 一一对应：`console.debug` → debug，`console.log` 和
`console.info` → info，依此类推。生成的 Flutter 宿主也打名字而不是数字：

```dart
engine.onLog = (level, message) =>
    debugPrint('[js:${FjsLogLevel.of(level).name}] $message');
```

两条命令都**不直接连设备**，而是接到 `fjs dev` 上：dev server 本来就握着每个应用
的 socket，工具只要自报身份（`{"fjs":"tool"}`）由它转发即可。手机上不用开任何新
端口，模拟器、局域网真机、浏览器构建三种情况用法完全一样。

服务端按身份区分两类客户端：应用和工具。工具永远收不到 `reload`（否则 `fjs log`
会被当成一个"客户端"计数），应用也永远收不到别的工具的流量。

### eval 的返回值怎么回来的

`fjs eval` 把表达式包一层再下发，包装里用 `console.log` 把结果按 JSON 打印出来，
前缀是一个带 NUL 的标记加一次性 id。也就是说**返回值走的是日志通道**，不需要新增
消息类型，更不需要一个"能返回值的 eval"原生接口。`fjs log` 会把带这个标记的行过
滤掉，所以看日志的人不会看见别人的求值结果。

id 单独放在 `eval <id> <source>` 的外层而不是只藏在包装里：语法错误在包装的
try/catch 之前就抛了，这时得由宿主用这个 id 把错误答回去，否则调用方只能等超时。

```
$ fjs eval 'oops('
fjs: Unexpected token ';'
$ fjs eval 'nope.deep'
fjs: nope is not defined
```

## 性能面板

`fjs dev` 跑着的时候按 **`p`**，连着的 app 右上角会浮出一个小面板；再按一次收起。
它可以拖，因为它一定会挡住点东西。

```
fps                3
ui        4.3/60.9 ms
gpu        1.3/2.7 ms
heap   4.6MB·14806
nodes            100
```

| 行 | 是什么 |
|---|---|
| `fps` | 最近一秒 Flutter 真正出了多少帧。**闲着的时候低是正常的**——没人要求画，所以它不标红 |
| `ui` | UI 线程那一半（build + layout + paint）：最近一秒的均值 / 面板打开以来的最坏值。**JS 也在这里**：引擎跑在 Flutter 的 UI isolate 上，一次慢重排落在这个数字里，不像 RN 那样单独有个 "JS fps" |
| `gpu` | 光栅线程那一半，同样两个数。这里大而 `ui` 小，要修的是画了什么，不是建了什么 |
| `heap` | JS 引擎的 malloc 大小和活对象数，**不触发回收**读出来的。对象数是预测回收代价的那个——QuickJS 标记整个堆 |
| `nodes` | 镜像树节点数，也就是 JS 建出来的东西在 Dart 侧有多少个 |

超过 16.7ms 的 `ui` / `gpu` 标红。**最坏值不随一秒的窗口滚掉**：值得看的那一帧
通常是刚点的那一下造成的，等人看到面板时滚动窗口早就忘了它；收起再打开就是重置。

面板每 500ms 采一次，不是每帧——每帧重画的监视器会让 app 一直在动，把它自己报的
fps 抬上去。

实现上它是 Dart 侧的一层浮层（`FjsPerfOverlay`，`FjsApp` 自动装），**不是 fjs 节点**
——否则它会把自己加进被测的那棵树里，切主题时还跟着一起重排。手写宿主（自己摆
`FjsView` 的）把它包一层就有：

```dart
FjsPerfOverlay(engine: engine, child: FjsView(engine: engine))
```

堆那一行需要引擎导出 `fjs_vm_heap`（`gc()` 也报同样两个数，但它得跑一次全堆标记
清扫才能拿到——对每秒采样的面板是错的工具）。这个符号是 ABI v1 之后加的，宿主按
**可选**处理：老的引擎二进制上这一行显示 `n/a`，面板其余部分照常。

## 看设备

```bash
fjs devices          # fjs run 能用的 android/ios 设备，带 * 的是默认选择
fjs devices --json
```

`flutter devices` 会把桌面端和 web 一起列出来，这条只留 fjs 真正能跑的两端，并且
把 `-d` 要填的 id 单独成列。排序和 `fjs run` 的挑选规则一致：模拟器优先，因为它
用主机本地地址就能连上 dev server，真机则依赖局域网可达。

## 清理

```bash
fjs clean                # dist/、Flutter assets 里的 release 产物、生成的路由类型
fjs clean --dry-run      # 只打印
fjs clean --all          # 连 .fjs/flutter 一起删（下次 fjs run 会重建）
```

只删这个 CLI 自己写出来的东西，且只删项目目录内的路径——`--out` / `--flutter-dir`
指到项目外会直接报错而不是照删。

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
fjs run android --release --gz
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

如果请求端口已被别的项目或其他进程占用，`fjs run` 会从该端口开始自动向后查找可用
端口，并把最终端口写进 `FJS_DEV`。如果端口上已经是同一个项目的 fjs dev server，则
直接复用它。

常用参数：

```bash
fjs run ios --device <device-id>
fjs run android --port 38913
fjs run android --profile
fjs run android --release --gz
fjs run android -- --dart-define=FOO=bar
```

**Android 运行注意事项**：Flutter 和直接 gradle 使用的 JDK 可能不同。Android
release 构建建议显式指定 JDK 17：

```bash
flutter config --jdk-dir=$(/usr/libexec/java_home -v 17)
```

配置后重新运行 `fjs run android`。如果之前启动过 Gradle，可先停止 Gradle daemon：

```bash
cd .fjs/flutter/android
./gradlew --stop
```

三种构建模式：

| 命令 | Flutter 模式 | JS 从哪来 |
|------|------|------|
| `fjs run android` | debug | dev server，改了就热更 |
| `fjs run android --profile` | profile | 打好的 `.fjsbundle` assets |
| `fjs run android --release` | release | 打好的 `.fjsbundle` assets |

`--profile` 和 `--release` 都会先同步 release assets 再 `flutter run --<模式>`，
不启动 dev server。profile 之所以跟 release 一样走 assets：这个模式是用来量性能
的，而 AOT 的宿主配上 dev server 喂过来的源码包，量到的是开发路径而不是发布路径。

要「AOT 宿主 + 仍然热更的 JS」（比如排查只在 profile 下复现的问题），用透传即可
——透传参数不会触发 assets 构建：

```bash
fjs run android -- --profile
```

`--release` / `--profile` 默认使用 pages split；纯 TS 单包项目可加 `--no-pages`。
JS 默认压缩，`--no-minify` 可以关掉；`--gz` 只压缩同步到 Flutter assets 的
`.fjsbundle`。

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
pnpm test                           # 单测：@ufjs/runtime + @ufjs/cli（vitest）
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
| `fjs build --bytecode` | `dist/bundle.js` + `dist/bundle.fjsbundle` | 单包字节码 |
| `fjs build --pages` | `dist/shared.js`、`dist/bundle.js`、`dist/pages/*.js` | App 分页加载 |
| `fjs build --web` | `dist/web` | CLI 内置 Web 静态构建 |
| `fjs build --release` | 单包 `.fjsbundle` + Flutter assets | 纯 TS 发布构建 |
| `fjs build --pages --release` | split `.fjsbundle` + Flutter assets | Vue pages 发布构建 |
| `fjs build --release --apk` | release assets + APK | 纯 TS Android 打包 |
| `fjs build --profile --apk` | release assets + profile APK | 量性能用的包 |
| `fjs build --pages --release --apk` | release assets + APK | Vue pages Android 打包 |

`--web` 和 `--pages` 互斥。

Web 端有两条路，都从 `src/pages` 走同一张路由表和同一套平台门控：默认
Vue3+Vite 模板的 `pnpm run build:web` 是标准的 `vite build`，上表里的
`fjs build --web` 是 CLI 内置的 esbuild Web 构建。两者产物都落在 `dist/web/`
——模板的 `vite.config.ts` 里写了 `build.outDir: 'dist/web'`，否则 `vite build`
默认会清空整个 `dist/`，把 `fjs build` 刚产出的 `dist/bundle.js` 一起删掉。

## 体积分析

```bash
fjs build --pages --bytecode --analyze
fjs build --web --analyze
```

按产物打印 js / gzip / 字节码三个尺寸，再列出每个产物里占比最大的几个包：

```text
shared.js  402.3 KB  gz 90.9 KB  bytecode 1.1 MB
  @vue/runtime-core                       254.5 KB   63.3%
  @vue/reactivity                          56.1 KB   14.0%
  @vue/shared                              25.8 KB    6.4%
  other                                    49.9 KB   12.4%
```

数字来自 esbuild 的 metafile（只有加了 `--analyze` 才会生成），是每个模块**进到这
个产物里**的字节数，不是它在磁盘上的大小；低于 2% 的模块和打包器自己的外壳一起并
进 `other`，所以百分比列永远加得起来。`--web` 的分片产物也会逐个列出。

字节码那一列是最该盯的：它决定冷启动要读多少，而且通常是 JS 的两三倍。

## 首帧节点数预警

`fjs build` / `fjs dev` 会对 `src/pages/**/*.vue` 做一次保守的静态估算：如果页面
首帧会一次性创建太多 fjs 节点，就输出 `[fjs perf]` warning。默认预算是 500 个节点，
可以在 `package.json` 里调整：

```json
{
  "fjs": {
    "performance": {
      "nodeBudget": 800
    }
  }
}
```

这不是耗时预测，也不会执行页面代码；它只识别字面量数组、`ref(200)`、
`computed(() => Array.from({ length: rows.value }))` 这类无副作用表达式，并沿本地
`.vue` 子组件递归估算。遇到预警时，优先考虑把大列表改成 `list-view`/窗口化、降低默认
行数，或把非首屏内容延后渲染。

## Release 构建

推荐发布命令：

```bash
fjs build --release          # 纯 TS / 单包项目
fjs build --pages --release  # Vue pages 项目
```

它会自动打开 `--bytecode`，并同步 release assets。JS 默认压缩，所以 bytecode
来自 minified JS；调试产物时可以用 `--no-minify` 关掉。gzip release assets 不是
默认行为，需要显式加 `--gz`：

```bash
fjs build --release --gz
fjs build --pages --release --gz
```

并同步到 Flutter 宿主：

```text
.fjs/flutter/assets/fjs/
  manifest.json
  bundle.fjsbundle
  shared.fjsbundle      # 仅 --pages
  pages/
    index.fjsbundle     # 仅 --pages
  public/               # 本地文件，见下
    images/x.png        # public/ 原样搬过来
    assets/x-<hash>.png # 页面 import 进来的资源
```

### 本地文件（图片、字体…）

页面拿本地文件有两条路，两条都会进 App 包（specs/017-local-image-assets）：

| 写法 | 打包器怎么处理 | 落到哪 |
|------|----------------|--------|
| `import png from '@/assets/x.png'` | esbuild 的 `file` loader，产物是 `dist/assets/x-<hash>.png`，代码里拿到 `/assets/x-<hash>.png` | `assets/fjs/public/assets/` |
| `public/images/x.png`，页面写 `/images/x.png` | 不经过打包器，原样搬 | `assets/fjs/public/images/` |
| `html/guide.html`，页面写 `/html/guide.html` | 不经过打包器，原样搬 | `assets/fjs/public/html/` |

**`public/` 与 `html/` 的分工**：`public/` 是 vite 的约定，映射到站点根；
`html/` 是 `<web-view>` 能打开的页面的**唯一位置**，目录名留在 URL 里
（`/html/guide.html`）。两个目录因此不共用根命名空间，同名文件不会互相覆盖。

**生成物**：`fjs` 会把这两个目录扫成 `src/fjs-assets.d.ts`（和
`fjs-routes.d.ts`、`fjs-modules.d.ts` 一样是生成的，别手改、别提交时纠结它），
编辑器靠它补全 `<image src>` 与 `<web-view src>`。写死的本地 src 指向不存在的
文件时，`fjs build` 会 warn 并给出最接近的候选。

两条最终都是**根绝对路径**，所以同一份源码在浏览器和 App 上取到同一张图。
Flutter 侧连着 `fjs dev` 时向 dev server 要，release 时读 `assets/fjs/public/`
下的 Flutter asset（`lib/src/widgets/image.dart`）。

注意两件事：

- **`public/` 是整个目录搬过去的**，包括只给 web 用的文件（hello-fjs 的
  `public/fjs-modules/webview/demo.html` 就是）。想控包体就别往 `public/` 里
  放只有 web 需要的大文件。
- **pubspec 里每一级目录都要单独列**，`fjs run` 自动生成时已经这么做了 ——
  Flutter 的 asset glob 不递归，只写 `- assets/fjs/public/` 会漏掉子目录，而且
  不报错，只是 release 包里少几张图。

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

`fjs run` 会自动启动这个 server，并在端口被占用时尝试 `38901`、`38902` ……。
手动连接 Flutter 宿主时可以使用：

```dart
final engine = FjsEngine();
await engine.connectDev('192.168.x.x', 38900);
```

### 终端快捷键

server 跑起来后，终端本身就是个控制台（只在交互式终端里生效，被 `fjs run` 拉起
或输出被重定向时自动关闭）：

| 键 | 作用 |
| --- | --- |
| `r` | 重新构建并推一次完整 reload |
| `l` | 开关应用日志（和 `fjs log` 同一条流，不用再开一个终端） |
| `d` | 打印当前连着几个应用、几个工具 |
| `c` | 再打印一次地址和二维码 |
| `o` | `--web` 模式下用浏览器打开 |
| `?` | 列出全部快捷键 |
| `q` | 退出（Ctrl+C 也一样） |

`r` 和文件监听不同：它不做增量判断，一律整包重建再推 `reload`，正是热更新判断
出错时该用的那一下。

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

Flutter 和直接 gradle 使用的 JDK 可能不同。Android release 构建建议指定 JDK 17：

```bash
flutter config --jdk-dir=$(/usr/libexec/java_home -v 17)
cd .fjs/flutter/android
./gradlew --stop
```

## 相关

- [分包与 release assets](code-splitting.md)
- [路由](routing.md)
- [Web 平台](web.md)
- [Vue 3 集成](vue3.md)
