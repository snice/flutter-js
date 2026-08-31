# 发布

仓库对外发三个包，走两条互相独立的链路：

| 包 | 目录 | registry |
|---|---|---|
| `@ufjs/cli` | `packages/fjs` | npm |
| `@ufjs/runtime` | `packages/fjs-runtime` | npm |
| `flutter_fjs` | `packages/flutter_fjs` | pub.dev |

三者的版本号保持一致，同一个版本一起发。

应用侧代码里的 `fjs`、`fjs/vue`、`fjs/router`、`fjs/app`、`fjs/web` 是 tsconfig
paths 加打包器 alias，**不是 npm 包名**。改 npm 包名不会影响用户的 import。

## 改版本号

版本号散在 9 个地方，发布前一次性改完。漏掉 podspec 或 CMakeLists 不会让构建
失败，只会让产物里的版本对不上：

```
packages/fjs/package.json                       version
packages/fjs-runtime/package.json               version
packages/fjs/src/create.ts                      两处模板的 @ufjs/cli + @ufjs/runtime（^x.y.z，共 4 行）
packages/fjs/src/run.ts                         生成宿主 pubspec 里的 flutter_fjs: ^x.y.z
packages/flutter_fjs/pubspec.yaml               version
packages/flutter_fjs/ios/flutter_fjs.podspec    s.version
packages/flutter_fjs/macos/flutter_fjs.podspec  s.version
packages/flutter_fjs/native/CMakeLists.txt      FJS_VERSION
packages/flutter_fjs/CHANGELOG.md               新增一节
```

改完自查：

```bash
git grep -n "0\.1\.0" -- packages ':!*.lock' ':!packages/flutter_fjs/native/quickjs'
```

## 发布前检查

```bash
pnpm install
pnpm -r --if-present run typecheck
pnpm --filter @ufjs/runtime run test
pnpm --filter @ufjs/cli run build

cd packages/flutter_fjs
cmake -B native/build-native -S native -DFJS_BUILD_TESTS=ON
cmake --build native/build-native -j
./native/build-native/fjs-test
flutter analyze && flutter test
```

先构建 host dylib 再跑 `flutter test`：`test/nav_router_test.dart` 要用
`native/build-native/libfjs.dylib` 起真实 VM，**找不到就整个文件静默跳过**
（输出是 `No tests ran`，不是失败）。少跑 6 个用例不会有任何提示。

`native/build-native/` 里的 CMake cache 记的是绝对路径。目录被重命名或移动过
之后 cmake 会报 `does not match the source ... used to generate cache`，
`rm -rf native/build-native` 重来即可。

再跑一遍从 tarball 装的真实链路——`pnpm publish` 会改写 `workspace:*`，只有打包
后才能验证依赖声明是对的：

```bash
cd packages/fjs         && pnpm pack --pack-destination /tmp/fjspack
cd ../fjs-runtime       && pnpm pack --pack-destination /tmp/fjspack

mkdir -p /tmp/fjscheck && cd /tmp/fjscheck && npm init -y
npm i /tmp/fjspack/ufjs-runtime-*.tgz /tmp/fjspack/ufjs-cli-*.tgz
./node_modules/.bin/fjs create myapp && cd myapp && npm i
npx fjs build --pages && npx vue-tsc --noEmit && npx vite build
```

用 `--pages` 而不是 `fjs build`：分包路径会同时压到 `runtimeDir()` 解析和 volar
插件解析，这两处都依赖包名和安装布局，是改名后最容易断的地方。

## 配置 npm 凭据

### 建 token

在 https://www.npmjs.com/settings/<用户名>/tokens 新建 **Granular Access Token**，
两项权限缺一不可：

- **Packages and scopes**：`Read and write`，作用范围选 `@ufjs` scope（或
  All packages）。这是发布本身需要的。
- **Organizations**：`ufjs` 给 `Read and write`。这项不影响发布，但没有它
  `npm org ls`、`npm access list packages` 全都会 403，出问题时没法自查。

### 写进配置

```bash
npm config set //registry.npmjs.org/:_authToken=<token>
```

写进 `~/.npmrc`，和 `registry=https://registry.npmjs.org/` 并列。也可以用交互式
`npm login`（走浏览器 2FA），效果一样。

CI 里不要落盘，用环境变量加一个项目级 `.npmrc`：

```
//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}
```

**这个 `.npmrc` 不要提交。** 根 `.gitignore` 已经忽略了 `.npmrc`。

### 自查

```bash
npm whoami                        # 应该返回用户名
npm access list packages @ufjs    # 应该列出 @ufjs 下的包
```

只有 `npm whoami` 通、其它全 403，说明 token 建出来了但权限给窄了——`whoami`
是唯一不需要额外权限的调用，**它通过不代表能发布**。这种情况下直接发会得到一个
误导性的 404（见下）。

## 发 npm

**必须用 `pnpm publish`。** `npm publish` 不会把 `"@ufjs/runtime": "workspace:*"`
改写成真实版本号，发出去的包用户装完会报 `EUNSUPPORTEDPROTOCOL`。

账号需要对 `@ufjs` scope 有写权限。npm 对「没有写权限的 scope」返回的是 **404**
而不是 403，所以发布时看到

```
npm error 404 Not Found - PUT https://registry.npmjs.org/@ufjs%2fruntime
```

要往 scope 权限上查，不是包内容的问题。权限对了但开了 2FA 的话报的是 `EOTP`，
那已经是最后一步了。

npm 正在收紧「绕过 2FA 的 token」（发布时会看到
`npm tokens that bypass 2FA are being restricted` 这条提示），所以按现在的策略，
即使 token 权限完全正确，发布仍然需要 OTP。

一次发一个，OTP 有效期只有 30 秒左右，`-r` 连发两个第二个容易过期：

```bash
pnpm publish --filter @ufjs/runtime --otp=<6位码>
pnpm publish --filter @ufjs/cli     --otp=<6位码>
```

先 runtime 后 cli，`@ufjs/cli` 依赖 `@ufjs/runtime` 的同版本号。

工作区不干净时 `pnpm publish` 的 git check 会拦，正常做法是先 commit；确实需要
绕过时加 `--no-git-checks`。

发完验证（registry 的 CDN 有几分钟缓存，刚发完查 404 是正常的，以真实安装为准）：

```bash
cd /tmp && rm -rf regtest && mkdir regtest && cd regtest && npm init -y
npm i -D @ufjs/cli @ufjs/runtime
./node_modules/.bin/fjs create myapp && cd myapp && npm i
npx fjs build --pages
```

## 发 pub.dev

`flutter_fjs` 把原生引擎**预编译后随包发布**，接入方不需要 NDK、CMake 或任何
原生编译步骤：

| 平台 | 产物 | 大小 |
|---|---|---|
| Android | `android/src/main/jniLibs/{armeabi-v7a,arm64-v8a,x86_64}/libfjs.so` | 3.7M |
| iOS / macOS | `ios/fjs.xcframework`、`macos/fjs.xcframework` | 各 5.9M |

反过来，`native/`（QuickJS-ng + fjs C++ 源码，2.6M）和 `tool/` **不发布**——
接入方的构建里没有任何东西会编译它们，脚本离开仓库也跑不了。这由
`packages/flutter_fjs/.pubignore` 控制。

`.pubignore` 只影响 `pub publish` 上传的内容，**不影响 `path:` 依赖**：在仓库里
用 workspace 调试时 `native/` 照常在。

许可有个连带约束：二进制里含 QuickJS-ng 代码，MIT 要求随分发附上许可全文，而
`native/quickjs/LICENSE` 已经不发布了。所以根目录有一份 `LICENSE-quickjs-ng`，
`NOTICE` 指向它。动 `.pubignore` 时别把这两个文件排除掉。

### 重建预编译产物

**只要改过 `packages/flutter_fjs/native/`，发布前必须重建并提交。** 产物是 git
跟踪的，忘记重建就会发出一个和源码对不上的包：

```bash
cd packages/flutter_fjs
ANDROID_NDK_HOME=~/Library/Android/sdk/ndk/27.1.12297006 tool/build-android.sh
tool/build-apple.sh          # 需要 macOS + Xcode
# 或两条一起：tool/build-native-artifacts.sh
```

`build-android.sh` 找不到 NDK 时会读 `ANDROID_NDK_ROOT`，再退到
`$ANDROID_HOME/ndk/` 下版本号最大的那个。产物会被 `llvm-strip` 处理。

`build-apple.sh` 产出的是**静态库切片**，不是 dynamic framework。原因是 pub.dev
拒绝发布含目录软链的包，而 macOS 的 versioned framework bundle 正是靠软链搭起来
的（拍平后 Xcode 直接报 `expected Versions/Current/Resources/Info.plist`）。脚本
结尾有一道 `find -type l` 断言，改动这块时别把它去掉。

静态切片带来一个约束：**`Classes/FlutterFjsPlugin.m` 里的 `kFjsKeepAlive` 表要和
`native/include/fjs.h` 的入口点保持同步。** 静态库没有任何东西在链接期引用
`fjs_*`，归档成员不会被拉进来；那张 `__attribute__((used))` 表是唯一的锚点。加了
新的 C ABI 入口点却忘了加进表里，Debug 下可能因为别的引用侥幸能跑，Release 下
`DynamicLibrary.process()` 会找不到符号。

验证符号确实进了 App（不要只看编译通过）：

```bash
cd examples/fjs-go
flutter build ios --release --no-codesign
xcrun dyld_info -exports build/ios/iphoneos/Runner.app/Frameworks/flutter_fjs.framework/flutter_fjs | grep _fjs_
```

Android 侧确认 `.so` 进包了：

```bash
flutter build apk --debug --target-platform android-arm64
unzip -l build/app/outputs/flutter-apk/app-debug.apk | grep libfjs
```

### 发布

```bash
cd packages/flutter_fjs
PUB_HOSTED_URL=https://pub.dev flutter pub publish --dry-run   # 应该是 0 warnings
PUB_HOSTED_URL=https://pub.dev flutter pub publish
```

**`PUB_HOSTED_URL` 不能省。** 国内开发机常在 `~/.zshrc` 里
`export PUB_HOSTED_URL=https://pub.flutter-io.cn`，而 `pub publish` 会拿它当
发布目标——镜像是只读的，传不上去。按 y 之前先确认输出第一行是
`Publishing flutter_fjs x.y.z to https://pub.dev:`。

不要试图用 `pubspec.yaml` 里的 `publish_to: https://pub.dev` 来钉死它：本地
dry-run 会通过，但 pub.dev 服务端在**上传之后**才校验，直接拒绝：

```
Message from server: Invalid `publish_to` value: `https://pub.dev`.
```

`publish_to` 只接受 `none` 或第三方 server 地址，指向 pub.dev 自己是非法的。

首次发布需要 pub.dev 的凭据（走浏览器 OAuth，和 npm token 是两套）：

```bash
PUB_HOSTED_URL=https://pub.dev flutter pub login
```

凭据落在 `~/Library/Application Support/dart/pub-credentials.json`。

dry-run 报「checked-in files are ignored by a .gitignore」时，是 git 索引和
`.gitignore` 打架了（比如产物先被提交、后被加进 ignore）。用 `git add -A` 刷新
索引，或把该文件 `git rm --cached`。

pub 发布的是 **git 跟踪的文件**，不是工作区快照。新生成的产物没 `git add` 过就
不会进包，dry-run 的文件树是唯一可信的清单，发前扫一眼。

## 许可

| 文件 | 内容 | 发布 |
|---|---|---|
| `LICENSE` | 项目自己的 MIT | ✅ |
| `LICENSE-quickjs-ng` | QuickJS-ng 的 MIT 全文 | ✅ |
| `NOTICE` | 说明预编译产物里含 QuickJS 代码 | ✅ |
| `native/quickjs/LICENSE` | 上游原件，`LICENSE-quickjs-ng` 是它的副本 | ❌ |

升级 QuickJS-ng 时，`LICENSE-quickjs-ng` 和 `NOTICE` 里的版本号要跟着
`native/quickjs/VERSION-quickjs-ng.txt` 一起更新。
