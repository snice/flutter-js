# Plan: 宿主 main.dart 定制附着、eject 路径修复与 @vueuse/motion 示例

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 涉及 | style shim 落在自定义渲染器的元素层：Flutter 端合成 DOM 形状对象，web 端是真 DOM 原生 `style`（`app/web.ts` 是普通 Vue DOM app，零改动）。motion 示例页一份源码两端跑；差异（drag/visibility 修饰器、级联读）登记 docs/web.md。 |
| II 边界即契约 | 不涉及 | 复用既有 setStyle 通道，op/natives/事件三张表不动。 |
| III 同步单线程零序列化 | 不涉及 | shim 写入同步走样式引擎 markDirty → 既有 flush。 |
| IV 外观照 WeUI | 不涉及 | 示例页样式照现有 example 页写法。 |
| V 静默失效是 bug | 涉及 | ① 托管 main.dart 改为"缺失才写"时打一行日志说明保留了用户版本；② ejected 宿主补丁幂等可观察；③ 无 bridge 时 style 写入 warnOnce（raw element API 场景）。 |
| VI 注释记录权衡 | 涉及 | shim 为何走引擎 inline 层而非本地记录、main.dart 为何从"每次重写"改"缺失才写"，在代码里留"为什么"。 |
| VII JS 能包就不要下 Dart | 涉及（反向） | 本 spec 不往 Dart 加运行时能力，反而是把 Dart 宿主的手改成本降下来；shim 在 JS 侧元素层。 |
| VIII 变更落到文档 | 涉及 | docs/toolchain.md（宿主文件所有权表、src/main.dart 约定、eject 行为）、docs/web.md（style shim 已知差异）。 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | `packages/fjs/src/commands/run.ts` | `writeHostMain` 拆分：静态 main 模板（调 `fjsRegisterModules` + `await fjsAttachHost`）；新增 `fjs_autolink.dart` / `fjs_attach.dart` 生成器；`ensureFlutterHost` 增加 `forceMain` 选项，managed 分支 main.dart 缺失才写 + 日志；ejected 分支也写两个生成文件并幂等补丁 main.dart |
| CLI / 构建 | `packages/fjs/src/project/modules.ts` | `autolinkDart` 产出改为 `{ import, function }`（fjs_autolink.dart 的文件内容），或新增 `autolinkDartModule(entries)` |
| CLI / 构建 | `packages/fjs/src/commands/host.ts` | `eject`：rename 后重写 pubspec 相对 `path:`；`sync --force` 传 `forceMain` |
| CLI / 构建 | `packages/fjs/src/commands/host.ts` | 新增纯函数 `repointRelativePaths(text, oldDir, newDir): string`（放 host.ts 或新 util），供 eject 调用 |
| JS runtime | `packages/fjs-runtime/src/ui/element.ts` | `Element` 增加 `style`（`makeElement` 里 `Object.defineProperty` 惰性创建）；模块级 `setElementStyleBridge()` 注入点 |
| JS runtime | `packages/fjs-runtime/src/css/style.ts` | `StyleEngine` 增加 `inlineRecord(id)` 读与 `mutateInline(id, key, value)` 单属性写（复用 setInlineStyle 的归一化与 markDirty） |
| JS runtime | `packages/fjs-runtime/src/vue/renderer.ts` | 模块初始化时 `setElementStyleBridge({ read, write })` 接到 styleEngine |
| 示例 | `examples/hello-fjs/package.json` | 补回 `"@vueuse/motion": "^3.0.3"`，`pnpm install` |
| 示例 | `examples/hello-fjs/src/pages/example/motion.vue` | 新页，`<route>` group「动画演示」：variants 入场 / 弹簧对比 / 数值循环 |
| 测试 | `packages/fjs/test/run.test.ts` | main 模板内容、autolink 模块生成、managed 缺失才写、ejected 幂等补丁、`repointRelativePaths` |
| 测试 | `packages/fjs-runtime/test/`（新增 element-style-shim.test.ts） | shim 写/读/setProperty/removeProperty；与 `:style` 绑定互不覆盖 |
| 文档 | `docs/toolchain.md`、`docs/web.md` | 所有权表与约定；已知差异 |

## 3. 方案

**宿主三文件布局**（spec §3.1/3.2；初版曾改为标记区间拼接，最终按用户实际的
src/main.dart 形态——带 import 的完整模块、定义 `fjsAttachHost`——定为约定
函数方案）：

- `lib/fjs_autolink.dart`：generated 头 + 模块 import + `void fjsRegisterModules(FjsEngine engine)`。managed 与 ejected 每次 run 都重写——模块集合本来就是 fjs 算出来的，ejected 用户改的是 main.dart / pubspec，不是这份机器产物。`reportAutolink` 的 ejected 分支改为"已写入 fjs_autolink.dart"的信息提示。
- `lib/fjs_attach.dart`：`<root>/src/main.dart` 存在则原样复制（项目是唯一事实来源），否则写空实现 `Future<void> fjsAttachHost(FjsEngine engine) async {}`。
- `lib/main.dart`：静态模板，`fjsRegisterModules(engine);` 与 `await fjsAttachHost(engine);` 依次插在 device register 之后、`const dev` 之前。managed 分支**缺失才写**；`ensureFlutterHost` 增加 `forceMain` 参数（`fjs host sync --force` 走 true）；ejected 分支对已存在的 main.dart 做幂等补丁（缺任一调用就补 import + 两个调用行，旧模板内联的 register 行精确匹配移除，避免双重注册）。"当前版本"的判定要求两个调用同时在（半新模板视同旧版重写一次）。

被否掉的备选：① 整文件文本拼接进 main()——用户文件带 import 时是语法错误，且拼接点脆弱；② 标记区间拼接（初版 v2）——同样要求片段无 import，约束隐晦。

**eject 路径修复**：纯函数 `repointRelativePaths` 只动 `path:` 值以 `.` 开头的行（dependencies 与 dependency_overrides 统一处理，YAML 行级正则足够——生成的 pubspec 格式是已知的；用户手改过的复杂 YAML 在 eject 场景下同样成立，因为只重写 `path:` 行）。旧目录 → 绝对目标 → 新目录相对值，`./` 前缀规则沿用 `autolinkPubspecDeps`。

**style shim**：写入走引擎而非本地记录，否则与 `:style` / `useCssVars` 互相覆盖（宪法 V 的静默失效）。`StyleEngine.mutateInline(id, key, value)` 单属性增删改，key 透传（与 `:style` 对象同一契约，motion 用 camelCase）；`value == null || ''` 删。读走 `inlineRecord(id)`（inline + `--` 前缀 custom 合并视图）。element.ts 通过模块级 bridge 注入拿到引擎（该文件不能 import renderer，会成环）；无 bridge（裸 element API / 旧测试环境）时本地记录兜底 + `warnOnce`。`style` 用 `Object.defineProperty` 惰性定义，未触碰的元素零开销（每个页面成百元素，多数从不被 DOM 库碰）。

被否掉的备选：① 示例内包装 target（用户提供的第三选项）——`v-motion` 指令拿不到包装对象，写法绕且不惠及其他库；② 仅 web 页——违背两端同源。

**motion 示例**：照 spec 031 的页面结构（`<route>` group「动画演示」）。用 v-motion 指令（initial/enter variants + stagger）与 `useMotion`/`useAnimate` 组合；不碰 drag/visibility（App 端无 Pointer Events / IntersectionObserver，且 `isBrowser` 守卫会自动关闭这些分支，不会崩）。

## 4. 风险

- **main.dart 缺失才写**是行为变更：已存在的托管宿主升级后 main.dart 停留在旧版（内联 register），而 fjs_autolink.dart 是新版——旧 main.dart 没有 `fjsRegisterModules` 调用，模块注册会静默消失。对策：ensureFlutterHost 在 managed 且 main.dart 存在但**不含新调用标记**时，视为旧生成物，直接重写（识别特征：文件里有旧模板的特征串，如 `engine.connectDevString`；含手改的旧版无法区分，靠 sync --force + 日志提示）。这条要写进 tasks 并配测试。
- **shim 读不到级联值**：motion 从 `el.style` 读初始状态，CSS 规则里的初值读不到，动画可能从错误起点开始。示例页用 `:initial` 显式给初值绕开；差异登记文档。
- **vue-tsc 对 v-motion 的类型**：MotionPlugin 的指令类型增强是否被 vue-tsc 识别待验证；不行就在 env.d.ts 补声明（tasks 里验证）。
- **eject 重写 pubspec** 对用户手工加的非常规 `path:` 行同样生效——按"仍解析到同一绝对目标"语义这是正确的，但 eject --dry-run（若有）应可见。

## 5. 验证路径

```bash
pnpm install                                        # 补 @vueuse/motion 条目
pnpm --filter @ufjs/cli test                        # 宿主生成/eject 用例
pnpm --filter @ufjs/runtime test                    # style shim 用例
pnpm --filter hello-fjs run typecheck               # motion 页 + v-motion 类型
pnpm --filter hello-fjs run build                   # 两连跑，验 main.dart 手改存活
pnpm --filter hello-fjs run dev:web                 # motion 页 web 端目验
cd examples/hello-fjs && pnpm exec fjs run android  # App 端目验 + eject 后 pub get
```
