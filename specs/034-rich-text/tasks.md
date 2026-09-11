# Tasks: rich-text 组件

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

op 协议 / natives / 事件类型三张表都不动（plan §1 II）。这一组只有「元素还是组件」的判定与类型。

- [x] T001 在 `packages/fjs-runtime/src/component-tags.json` 加 `"rich-text"`，确认 `packages/fjs/src/bundler/vue-plugin.ts` 与 `packages/fjs-runtime/volar.cjs` 读到它（不改这两个文件）
- [x] T002 在 `packages/fjs-runtime/src/vue-global.d.ts` 新增 `RichTextNode` 与 `FjsRichTextProps`（`nodes: string | RichTextNode[]`、`space?: 'ensp' | 'emsp' | 'nbsp'`、`userSelect`、`mode`、`onTap` / `onLongpress`），照 `textarea` 的四处注册 `rich-text` / `RichText`
- [x] T003 在 `packages/fjs-runtime/src/index.ts` 导出 `RichTextNode` 类型
- [x] T004 用脚本逐文件扫描 `examples/` 与 `demo/` 的 `.vue` 模板里 `text` 套 `text` 的位置，把结果记在本条后面（plan §4 风险 1），命中的留给 T034 处理 —— 结果：`examples/` 与 `demo/` 全部 .vue 模板里没有 `text` 套 `text`（用 compiler-sfc 解析模板 AST 扫描，含 span/p/b 等别名），T034 无需改动

## 实现

### JS：解析与布局（纯函数，无 Vue）

- [x] T010 写 `packages/fjs-runtime/src/rich-text/entities.ts`：十进制 / 十六进制数字实体 + plan §2 列出的命名实体表，未知实体原样保留
- [x] T011 写 `packages/fjs-runtime/src/rich-text/parse.ts`：HTML 字符串 → `RichTextNode[]`（标签 / 属性 / 文本 / 注释 / DOCTYPE、void 元素、自闭合、未闭合补齐、隐式结束 `p`），顶部注释写明为什么不用 `DOMParser`
- [x] T012 写 `packages/fjs-runtime/src/rich-text/sanitize.ts`：名字小写化、spec §3.3 白名单、非白名单连子树删除并按标签名 `warnOnce`、属性白名单（`class` / `style` + 各标签专属）、非法结构丢弃告警、文本实体解码
- [x] T013 写 `packages/fjs-runtime/src/rich-text/defaults.ts`：spec §3.4 的块 / 行内分类与默认样式（em 按 14px 折成 px），列表标记，`q` 的引号，`pre` / `code` / `tt` 的 `fontFamily: 'monospace'`
- [x] T014 写 `packages/fjs-runtime/src/rich-text/layout.ts` 的段落部分：净化后的树 → `RenderBlock[]`，块中连续行内收成匿名段落、行内套块时拆段、块间纯空白串丢弃（plan §3.2）
- [x] T015 在 `layout.ts` 实现空白处理：默认折叠、`pre` 转 U+00A0 与 tab、`space` 三档、`br` → `\n`、未知 `space` 告警（plan §3.3）
- [x] T016 在 `layout.ts` 实现列表：`li` 横排标记 + 内容，`ul` 三层标记，`ol` 的 `start` / `type`（含罗马数字）（plan §3.4）
- [x] T017 在 `layout.ts` 实现表格退化、`hr`、`q`、`sub` / `sup`、`img` 的 `width` / `height` → 样式与 `widthFix` / `heightFix`，`colspan` / `rowspan` 与百分比宽告警（plan §3.4、§4 风险 3）
- [x] T018 在 `layout.ts` 实现兄弟块默认 margin 折叠（plan §3.5）

### JS：组件

- [x] T019 写 `packages/fjs-runtime/src/components/rich-text.ts`：props（`nodes` / `space` / `userSelect` / `mode` 及其告警）、`computed` 布局描述、`resolveDynamicComponent` 生成 `view` / `text` / `image` / `divider`、根节点透传 `attrs`，顶部注释写为什么是组件
- [x] T020 在 `rich-text.ts` 给每个生成的 vnode 挂 `getCurrentInstance().vnode.scopeId`，注释写清依赖的 Vue 行为（plan §3.6）
- [x] T021 在 `packages/fjs-runtime/src/app/flutter.ts` 注册 `app.component('rich-text', FjsRichText)`

### Dart：嵌套 text 行内排版

- [x] T022 在 `packages/flutter_fjs/lib/src/render/style.dart` 加 `verticalAlign` getter，`fontFamily` getter 映射 `monospace` → iOS / macOS `Menlo`、Android `monospace`、其余 `Courier`（plan §3.9）
- [x] T023 在 `packages/flutter_fjs/lib/src/widgets/text.dart` 抽出 `fjsTextStyle(FjsStyle)`，`buildText` 改签名接收 `childNodes` 与 `buildNode`，保留单段快速路径
- [x] T024 在 `text.dart` 实现 `Text.rich` 路径：递归 `TextSpan`、其他标签 `WidgetSpan`（基线对齐）、`sub` / `super` 的平移 `WidgetSpan`、段落级属性只取根、隐藏节点跳过、片段上盒模型属性 debug `warnOnce`，注释写为什么读 `MirrorNode` 而不是子 widget（plan §3.7）
- [x] T025 更新调用方签名：`packages/flutter_fjs/lib/src/node/node_adapters.dart` 的 `_TextNodeAdapter.build`、`packages/flutter_fjs/lib/src/widgets/label.dart:82`
- [x] T026 在 `packages/flutter_fjs/lib/src/mirror_tree.dart` 的 `_touch` 里，父节点是 `text` 时继续上溯到段落根；逐个确认 `setText` / `setProps` / `setStyle` / 插入 / 删除 / 移动都经过 `_touch`（plan §4 风险 2）

## 两端对齐

- [x] T030 在 `packages/fjs-runtime/src/web/components/index.ts` 的 `fjsComponents` 注册同一个 `FjsRichText`
- [x] T031 在 `packages/fjs-runtime/src/web/base-css.ts` 的 `text {}` 规则后加 `text text`（`display: inline` 与盒模型归零，均 `!important`）与 `text > :not(text)`（`inline-flex`、基线对齐）两条，注释写 `!important` 的理由（plan §3.8）
- [x] T032 写示例页 `examples/hello-fjs/src/pages/comp/rich-text.vue`（route：富文本 / `rich-text` / 基础内容），分组：HTML 字符串、节点数组、`space` 三档、列表、表格、行内图片、`pre` 与上下标、scoped class、非白名单 `<script>`、切换 `nodes`、根上 `@tap` 计数、模板里嵌套 `text`
- [x] T033 在 `examples/hello-fjs/README.md` 登记富文本页
- [x] T034 处理 T004 扫到的现有嵌套 `text`：要保持竖排的改成 `view`，改前改后两端外观一致（spec §6.8） —— T004 未扫到任何嵌套，无需改动
- [x] T035 web 预览验证：Browser pane 起 `hello-fjs-web`，逐项对照 spec §6.4、§6.6，截图；控制台只应有 `<script>` 那一条白名单告警 —— 结果：标题层级与段落间距（h 与 p 默认 margin 折叠）、同一行内加粗 / 斜体 / 下划线 / 删除线 / mark / code 混排、ul 三层标记与 ol 的 start/type、表格网格、行内小图与文字同一行（段落高 23px 单行，修过一次 CSS 优先级）、pre 保留空白、上下标、blockquote、hr、space 三档（DOM 码位分别是 U+00A0 / U+2002 / U+2003）、scoped class 命中（内部节点带 data-v）、切换 nodes 整段更新、根上 @tap 一次点击计一次；控制台只有示例页故意触发的 colspan / script / iframe 三条 rich-text 告警，无报错
- [x] T036 iOS 模拟器验证：`pnpm --filter hello-fjs run run:ios`，同一份对照项，截图与 web 并排比较段落数 / 列表项数 / 图片数 / 表格行列数、上下标方向、间距（spec §6.5；**Android 不测**） —— 结果（iPhone 17 Pro / iOS 26.3）：与 web 逐段对照一致——标题与段落间距、同一行内加粗 / 斜体 / 下划线 / 删除线 / mark 黄底 / code 等宽（Menlo）/ 小字大字 / 引号、br、节点数组、space 三档宽度递增、ul 三层标记与 ol 编号、表格网格、行内小图与文字同一行、pre 保留缩进、上下标方向、blockquote、hr、scoped class 变绿、script / iframe 不显示（App 日志各一条告警）、模板嵌套 text 连成一行；点富文本 @tap 计 1 次，切换内容整段换成版本 B 列表。**修了一处**：第三层 ul 标记 U+25AA 是 emoji 码位，模拟器上是方框，换成 U+25A0 后正常。段落数 / 列表项数 / 图片数 / 表格行列数两端相同

## 测试

- [x] T040 写 `packages/fjs-runtime/test/rich-text-parse.test.ts`：实体、大小写、非白名单连子树删除且只告警一次、属性白名单、未闭合 / 错误嵌套容错、非法节点数组元素丢弃
- [x] T041 写 `packages/fjs-runtime/test/rich-text-layout.test.ts`：匿名段落与拆段、空白折叠与 `pre`、`space` 三档与未知值、`br`、`ol` 的 `start` / `type`、表格退化、margin 折叠、`img` 尺寸
- [x] T042 写 `packages/fjs-runtime/test/rich-text-component.test.ts`（happy-dom，挂 `fjsComponents` 版）：DOM 结构、内部节点带调用方 `data-v-xxx`、`nodes` 切换后整段更新、根上 `@tap`、`user-select` / `mode` 告警
- [x] T043 在 `packages/fjs-runtime/test/vue_styles.test.ts` 追加：Flutter 渲染路径下 rich-text 内部元素拿到调用方 scope 并命中 scoped 规则
- [x] T044 写 `packages/flutter_fjs/test/rich_text_test.dart`：三个样式不同的片段 → 一个 `RichText` 且 `TextSpan` 样式正确；行内 `image` 是 `WidgetSpan`；单段仍是 `Text`；`sub` / `super` 平移；深层片段 `setText` 与改颜色后段落刷新
- [x] T045 编 native（`cd packages/flutter_fjs/native && cmake -B build-native -DFJS_BUILD_TESTS=ON && cmake --build build-native -j`）后跑 `cd packages/flutter_fjs && flutter test`，`No tests ran` 视为失败 —— 结果：native 重编通过；`flutter test` 275 通过 / 3 跳过，无 No tests ran，含 rich_text_test.dart 5 条

## 文档

- [x] T050 更新 `docs/ui-api.md`：标签表加 `rich-text` 行与小节（props / 白名单 / 默认样式 / em 不缩放等与小程序的差异），`text` 行写明嵌套片段语义，「已知限制」删掉「文本嵌套富文本」那条
- [x] T051 更新 `docs/css-compat.md`：文字表加 `vertical-align`（仅 `sub` / `super`、仅片段）与 `font-family: monospace` 映射，新增「嵌套 text 片段」小段
- [x] T052 更新 `docs/web.md`「已知差异」：margin 只在默认值之间折叠（两端一致，与浏览器不同）
- [x] T053 `docs/roadmap.md` 登记 rich-text 完成，并单列「嵌套 `text` 变行内」breaking change 与迁移写法

## 验收

- [x] T060 `pnpm run typecheck` 与 `pnpm --filter hello-fjs run typecheck` —— 结果：workspace 全部包 typecheck Done（含 demo、hello-fjs 的 vue-tsc）
- [x] T061 `pnpm test` —— 结果：fjs 99 / fjs-webview 36 / fjs-runtime 331 / fjs-webgl 29 全部通过
- [x] T062 `cd packages/flutter_fjs && flutter test`（确认 `rich_text_test.dart` 真的跑了） —— 结果：All tests passed（+275 ~3），rich_text_test.dart 在列
- [x] T063 `pnpm --filter hello-fjs run build:pages` 与 `build:web` —— 结果：两个构建都成功，`dist/pages/comp-rich-text.js` 与 web 产物里的 rich-text 管线都在；vite 的「chunk 超过 500 kB」提示来自既有的 echarts / three 页，与本 spec 无关
- [x] T064 spec.md 第 6 节逐条核对（1–8），结果写在本条后面，spec 状态改为 `done` —— 核对：① typecheck 全过（T060）② pnpm test 全过，新增 rich-text-parse / -layout / -component 与 vue_styles 一条（T061）③ flutter test 全过，rich_text_test.dart 5 条（T062）④ web 逐项对照通过（T035）⑤ iOS 逐项对照通过、两端段落 / 列表项 / 图片 / 表格数一致（T036）⑥ 两端点击各计 1 次 ⑦ ui-api / css-compat / web.md / roadmap 已更新，含 breaking change ⑧ examples 与 demo 无嵌套 text，无需改动（T004 / T034）
