# pnpm monorepo 规范

> 第四层第 1 篇。这个仓库同时是 **npm workspace** 和 **pub 包仓库**，
> 两套包管理并存。这篇讲边界在哪、依赖怎么写、加一个包要做什么。

## 1. 两套包管理

```
flutter-js/
├── pnpm-workspace.yaml        ← 只管 JS 侧
├── packages/
│   ├── fjs/                   npm  @ufjs/cli
│   ├── fjs-runtime/           npm  @ufjs/runtime
│   ├── fjs-iconmind/          npm  @ufjs/iconmind      （同时含 Dart 子包）
│   ├── fjsc/                  npm  @ufjs/fjsc-<平台>   （预编译二进制）
│   └── flutter_fjs/           pub  flutter_fjs         ← 没有 package.json
├── demo/                      npm  private
└── examples/
    ├── hello-js/  hello-fjs/  bench/    npm  private
    └── fjs-go/                pub（Flutter app，无 package.json）
```

`pnpm-workspace.yaml` 里的 `examples/*` 用通配，**没有 `package.json` 的
目录会被自然跳过** —— `examples/fjs-go` 是 Flutter 应用，不参与 npm workspace。
`packages/flutter_fjs` 没有列进去，同理。

| | npm 侧 | pub 侧 |
|---|---|---|
| 包管理器 | pnpm 10.26.2（`packageManager` 字段锁死）| pub |
| 安装 | `pnpm install`（仓库根）| `flutter pub get`（各包内）|
| 发布 | `npm publish` | `flutter pub publish` |
| 版本 | 各包 package.json | pubspec.yaml |

**三者版本必须咬合**：`@ufjs/cli`、`@ufjs/runtime`、`flutter_fjs`。
`fjs doctor` 能发现不匹配但不能修；`fjs upgrade` 在 roadmap 里。

## 2. 依赖怎么写

### workspace 内互相依赖：`workspace:*`

```jsonc
// packages/fjs/package.json
"dependencies": { "@ufjs/runtime": "workspace:*" }

// demo/package.json
"devDependencies": {
  "@ufjs/cli": "workspace:*",
  "@ufjs/runtime": "workspace:*"
}
```

`pnpm install` 把它们链到源码，改完立刻生效，不走 npm。发布时 pnpm 会
自动替换成真实版本号。

### `@ufjs/runtime` 直接导出 TS 源码

```jsonc
"main": "src/index.ts",  "types": "src/index.ts",
"exports": { ".": "./src/index.ts", "./vue": "./src/vue/index.ts", ... }
```

它**不编译**，由使用方的 esbuild / Vite 一起打包。好处是 tree-shaking 和
类型跳转都直达源码；代价是它不能用任何需要编译步骤的语法。加新入口时
`exports` 和 `files` 两处都要加。

### `@ufjs/cli` 编译发布

`esbuild src/cli.ts src/vite.ts --bundle --platform=node --format=esm
--packages=external`，两个 entry 对应 `dist/cli.js` 和 `dist/vite.js` ——
所以 `cli.ts` / `vite.ts` 留在 `src/` 根上，其余按职责分子目录。

### 原生二进制走 optionalDependencies

```jsonc
"optionalDependencies": {
  "@ufjs/fjsc-darwin-arm64": "0.1.1",
  "@ufjs/fjsc-linux-x64": "0.1.1", ...
}
```

按平台自动装一个，用户不需要 CMake。**仓库里自编的 `fjsc` 优先于 npm 包** ——
改过 `native/` 就重新 `cmake --build build-native`，否则字节码是旧引擎编的。

### 应用侧的三方库：`fjs.packages`

```jsonc
// demo/package.json
"fjs": {
  "packages": ["pinia"],   // 允许打进 bundle 的 npm 包
  "shared": ["pinia"]      // 放进分包的共享 prelude
}
```

不是所有 npm 包都能在 QuickJS 上跑（没有 DOM、没有 Node API）。
用 `fjs add <包>` 装，它会同时写好这两个字段和必要的 plugin 文件。
见 [toolchain.md](toolchain.md#添加三方库)。

## 3. 在 workspace 里装一个本地包

要在 `demo` 或某个 example 里用上仓库内的另一个包（`@ufjs/iconmind`、
`@ufjs/runtime`、你自己新建的模块包），**显式带上 `workspace:` 协议**：

```bash
pnpm add @ufjs/iconmind@workspace:* --filter hello-fjs
```

或者直接改目标包的 `package.json` 再 `pnpm install`：

```jsonc
"dependencies": { "@ufjs/iconmind": "workspace:*" }
```

两种写法效果一样，仓库里现有的依赖全是后者。

**为什么必须带 `@workspace:*`**：pnpm 10 起 `link-workspace-packages` 默认是
`false`，`pnpm add <名字>` 不会自动优先本地包，会去 registry 找同名的那个。
本仓库没有 `.npmrc` 覆盖这个默认值，所以不写协议就可能装到一个发布版本上，
而不是你正在改的源码 —— 症状是「改了 packages/ 下的代码，example 里没反应」。

### 装的是包名，不是目录名

`pnpm add` 认的是 `package.json` 里的 `name`，两者经常不一样：

| 目录 | 包名 |
|---|---|
| `packages/fjs` | `@ufjs/cli` |
| `packages/fjs-runtime` | `@ufjs/runtime` |
| `packages/fjs-iconmind` | `@ufjs/iconmind` |

用目录名（`pnpm add fjs-iconmind`）会失败或装错东西。不确定就先
`cat packages/<目录>/package.json | head -3`。

### 模块包还要传 plugins

装的如果是 fjs **模块**（`package.json` 里有 `fjs.module`，比如
`@ufjs/iconmind`），除了装依赖，应用的 `src/main.ts` 还要把 `plugins` 交给
`createFjsApp`，模块的全局组件和 Flutter widget 才会注册进去：

```ts
import { createFjsApp } from 'fjs/app';
import { routes } from 'fjs/pages';
import { plugins } from 'fjs/plugins';   // 工具链生成
import Shell from './Shell.vue';

createFjsApp({ routes, shell: Shell, plugins }).mount();
```

之后模板里直接写标签，不用 import：

```vue
<icon-mind name="agent" :size="18" />
```

`fjs create` 的模板已经带上这一行；老项目补上即可。装完用 `fjs modules`
确认模块、全局组件和 Flutter autolink 都被扫到了。完整的模块契约见
[modules.md](modules.md)。

## 4. 根目录脚本

```bash
pnpm install                       # 装全部 JS 侧
pnpm run build                     # 只构建 @ufjs/cli
pnpm run typecheck                 # -r --if-present，全 workspace
pnpm test                          # -r --if-present，全 workspace
pnpm run build:examples            # --filter "./examples/**"
```

单包用 `--filter`：

```bash
pnpm --filter demo run typecheck
pnpm --filter @ufjs/runtime test
pnpm --filter hello-fjs run build:pages
pnpm add <pkg> --filter demo        # 装到某个包，不是根
```

**不要在根装业务依赖**。根 `package.json` 是 private 的，只放 workspace
脚本和 `pnpm.onlyBuiltDependencies`。

## 5. 加一个新包

### 加 npm 包

1. 建 `packages/<name>/package.json`，`name` 用 `@ufjs/` 前缀
2. 加进 `pnpm-workspace.yaml` 的 `packages` 列表（`examples/*` 通配不用加）
3. 必填字段照现有包抄：`license` / `repository`（含 `directory`）/
   `homepage` / `bugs` / `keywords` / `type: module` /
   `publishConfig.access: public` / `files`
4. `scripts` 里至少有 `typecheck`；有测试就加 `test`（vitest）——
   根脚本靠 `--if-present` 自动带上
5. `pnpm install` 让链接生效

### 加 example

放 `examples/<name>/`，`"private": true`，用 `workspace:*` 依赖
`@ufjs/cli` 和 `@ufjs/runtime`。有 `package.json` 就自动进 workspace。

### 加 Flutter 侧包

放 `packages/<name>/`，只有 `pubspec.yaml`，**不要**加进
`pnpm-workspace.yaml`。要被 fjs 模块 autolink 的话，在对应 npm 包的
`fjs.flutter` 字段里指过去，见 [modules.md](modules.md#flutter-侧-autolink)。

## 6. 一个包同时有 npm 和 Dart：`@ufjs/iconmind` 的形状

模块扩展的标准形态，也是唯一的参考实现：

```
packages/fjs-iconmind/
├── package.json          ← fjs 字段声明模块清单
├── index.ts              ← JS API
├── components/           ← Vue 组件（web 侧实现）
├── flutter/              ← Dart 子包 fjs_iconmind（Flutter 侧实现）
└── prepare.mjs           ← 构建期代码生成
```

`package.json` 的 `fjs` 字段是模块清单：`components`（全局组件目录）、
`componentPrefix`、`widgets`（标签 → web 实现 + props 类型）、
`flutter`（Dart 包名 / 路径 / import / 注册调用）、`prepare`。
装上即 autolink，两端各自绘制。完整说明见
[modules.md](modules.md)。

装法（含 `workspace:` 协议和必须传的 `plugins`）见上面
[第 3 节](#3-在-workspace-里装一个本地包)。

## 7. 版本与发布

| 场景 | 要一起动的 |
|---|---|
| 改 op 协议 / natives | `@ufjs/runtime` + `flutter_fjs`（+ 重编 `fjsc`）|
| 改 CLI 命令 | `@ufjs/cli`（+ `docs/toolchain.md`）|
| 改 `native/` | 重新生成预编译产物并提交，见下 |

改 `packages/flutter_fjs/native/` 后，随包发布的产物要重新生成：

```bash
cd packages/flutter_fjs
ANDROID_NDK_HOME=... tool/build-android.sh   # jniLibs/*/libfjs.so
tool/build-apple.sh                          # ios|macos/fjs.xcframework（需 macOS + Xcode）
```

完整发布流程（含 npm 与 pub.dev 的顺序、dry-run、CI）见
[publishing.md](publishing.md)。

## 8. CI

`.github/workflows/`：

- `fjs-go-android-apk.yml` —— 打 fjs-go 调试客户端 APK 并挂到 Release
- `fjsc-release.yml` —— 各平台交叉编译 `fjsc` 并发 `@ufjs/fjsc-<平台>`

## 相关

- [工具链](toolchain.md) —— 命令细节
- [模块扩展](modules.md)
- [发布](publishing.md)
- [分包与 release assets](code-splitting.md)
