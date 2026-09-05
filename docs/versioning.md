# 改版本号

发版时改版本号的**唯一清单**。发布流程本身（凭据、打包、验证、pub/npm 的坑）
在 [发布](publishing.md)，这里只管「哪些文件写着版本号」。

## 版本策略

五个对外包**同版本号、一起发**。哪怕某个包这一轮一行没改，也跟着走同一个号——
用户看到的是一套工具链，`@ufjs/cli` 0.1.3 配 `@ufjs/runtime` 0.1.2 这种组合没
人愿意去推理是否兼容。

| 包 | 目录 | registry |
|---|---|---|
| `@ufjs/cli` | `packages/fjs` | npm |
| `@ufjs/runtime` | `packages/fjs-runtime` | npm |
| `@ufjs/iconmind` | `packages/fjs-iconmind` | npm |
| `@ufjs/webview` | `packages/fjs-webview` | npm |
| `flutter_fjs` | `packages/flutter_fjs` | pub.dev |

`@ufjs/fjsc-<platform>` ×5 是**另一条线**，见下面「fjsc 什么时候跟着动」。

漏发过某个包的话，下一轮统一到最高号往上补一位，不要给漏掉的那个单独补号。
0.1.3 就是这么来的：`@ufjs/cli` 发到了 0.1.2，`@ufjs/runtime` 停在 0.1.1，
iconmind / webview 从没发过——五个一起跳到 0.1.3，CHANGELOG 里缺的那一节就空着，
registry 不要求版本号连续。

## 清单

把 `x.y.z` 换成新版本号，逐行改完。**没有一处会因为漏改而构建失败**，只会让
产物里的版本对不上、或者让 `fjs create` 出来的新项目装到旧包上。

### 包自身的版本

```
packages/fjs/package.json                       "version"
packages/fjs-runtime/package.json               "version"
packages/fjs-iconmind/package.json              "version"
packages/fjs-webview/package.json               "version"
packages/flutter_fjs/pubspec.yaml               version:
```

### flutter_fjs 的原生产物

pub 不看它们，但它们会进 App 的构建产物，对不上时排查现场版本会指向错的那次
发布：

```
packages/flutter_fjs/ios/flutter_fjs.podspec    s.version
packages/flutter_fjs/macos/flutter_fjs.podspec  s.version
packages/flutter_fjs/native/CMakeLists.txt      FJS_VERSION
```

### 生成到用户项目里的版本

这些是模板字符串，`fjs create` / `fjs module` / `fjs run` 把它们写进用户的
package.json 和 pubspec。改漏了新项目会装上旧包，而且报错发生在用户那边：

```
packages/fjs/src/commands/create.ts   两套模板（vue / ts）的
                                      '@ufjs/cli': '^x.y.z'
                                      '@ufjs/runtime': '^x.y.z'      共 4 行
packages/fjs/src/commands/module.ts   生成模块 pubspec 的 flutter_fjs: ^x.y.z
packages/fjs/src/commands/run.ts      生成宿主 pubspec 的 flutter_fjs: ^x.y.z
                                      （仅在仓库里找不到 flutter_fjs 时用）
```

### 模块自带的 Flutter 包

iconmind / webview 各带一个 Flutter 子包，它们的 `version: 0.0.1` **不用改**
（`publish_to: none`，跟着 npm 包走），要改的是对 `flutter_fjs` 的约束：

```
packages/fjs-iconmind/flutter/pubspec.yaml      flutter_fjs: ^x.y.z
packages/fjs-webview/flutter/pubspec.yaml       flutter_fjs: ^x.y.z
```

只在这一轮真的用到了 `flutter_fjs` 新 API 时才抬——抬了就是给用户加约束。
0.1.3 抬了，因为 iconmind 的 widget 用了 0.1.3 才有的 `FjsEngine.devUri` /
`devFetch`。

`peerDependencies` 里的 `"@ufjs/runtime": ">=0.1.0"` 是**下限**，同理：只在真的
需要新 runtime 时抬，不跟着每轮版本走。

### 文档里的安装示例

```
packages/flutter_fjs/README.md                  dependencies: flutter_fjs: ^x.y.z
```

## 变更记录

每个包一份 `CHANGELOG.md`，都在包根目录，都在 `files` / `.pubignore` 允许的
范围内随包发布：

```
packages/fjs/CHANGELOG.md
packages/fjs-runtime/CHANGELOG.md
packages/fjs-iconmind/CHANGELOG.md
packages/fjs-webview/CHANGELOG.md
packages/flutter_fjs/CHANGELOG.md
```

写法：

- 每个版本一节 `## x.y.z`，最新在最上面。`flutter_fjs` 的格式由 pub.dev 渲染，
  标题必须是 `## <版本号>`，不要加日期或前缀，否则 pub 认不出来。
- 平时可以先攒在 `## Unreleased` 一节里，发版时把标题换成版本号。
- 一条一件事，写**做了什么改动**和**为什么**，不是提交标题的复述。判断标准：
  用户读完能不能知道自己要不要升、升了之后行为哪里变了。
- 只写这个包自己的改动。同一次提交动了三个包，就在三份 CHANGELOG 里各写各的
  那一面——用户装的是包，不是仓库。
- 这一轮没有任何改动的包，也写一节，一句「跟随 x.y.z 统一版本，无功能改动」。

取素材：

```bash
git log <上个版本的发布提交>..HEAD --oneline -- packages/<包目录>
```

## 改完自查

```bash
# 1. 旧版本号还有没有残留（引号里那个换成上一个版本）
git grep -n "0\.1\.2" -- packages ':!*.lock' ':!packages/flutter_fjs/native/quickjs'

# 2. 五个包的版本是不是真的一致
grep -m1 '"version"' packages/{fjs,fjs-runtime,fjs-iconmind,fjs-webview}/package.json
grep -m1 '^version:' packages/flutter_fjs/pubspec.yaml

# 3. 模板改对了没有
grep -rn "@ufjs/\(cli\|runtime\)': '\^" packages/fjs/src/commands/create.ts
grep -rn "flutter_fjs: \^" packages/fjs/src/commands/ packages/*/flutter/pubspec.yaml

# 4. 跑一遍测试（模板里的版本号没有断言，但别的会）
pnpm --filter @ufjs/cli run test
```

第 1 条会把 CHANGELOG 里的历史小节也扫出来——那是应该留着的，看一眼跳过即可。

## fjsc 什么时候跟着动

`@ufjs/fjsc-<platform>` ×5 的版本号**不在文件里写死**，`packages/fjsc/build.mjs`
是从 `packages/fjs/package.json` 的 `version` 读的。所以 `@ufjs/cli` 一升号，
下次跑 `build.mjs` 出来的就是同版本号的 fjsc 包。

而 `packages/fjs/package.json` 的 `optionalDependencies` 里那 5 行是**手写的**，
指向**已经发布**的 fjsc 版本：

```json
"@ufjs/fjsc-darwin-arm64": "0.1.1",
```

两种情况：

- **`native/` 没实质变化** —— 不重发 fjsc，`optionalDependencies` 那 5 行
  **原样不动**。改成新号会让用户装到一个不存在的包，而 optional 依赖装不上是
  静默跳过的，直到跑 `--bytecode` 才莫名其妙地失败。0.1.3 就是这一档：
  `native/` 只动了一个事件枚举和调试工具 `fjsrun.cpp`，QuickJS-ng 本身没动，
  字节码的 engine id 不变，已发布的 0.1.1 二进制照常能用。
- **`native/quickjs/` 升级过，或 fjsc 工具本身改了** —— 必须重编重发，5 行
  一起改成新版本号。bundle 头里有 engine id，`fjs_bundle_check` 在加载时会拒绝
  对不上的组合，所以这里出错不会静默。重编流程见
  [发布 → fjsc 二进制](publishing.md#fjsc-二进制)。

## 发布顺序

改完版本号和 CHANGELOG，提交，然后按 [发布](publishing.md) 走。顺序有依赖关系：

```
@ufjs/fjsc-*（如果这轮要发） → @ufjs/runtime → @ufjs/cli → @ufjs/iconmind、@ufjs/webview
flutter_fjs（pub.dev，和 npm 这条线互不影响，先后随意）
```

`@ufjs/cli` 依赖同版本的 `@ufjs/runtime`（`workspace:*` 由 `pnpm publish` 改写成
真实版本号，所以**必须用 `pnpm publish`**）。iconmind / webview 的 peer 指向
runtime，放最后。
