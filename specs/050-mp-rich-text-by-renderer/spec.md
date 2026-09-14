# Spec: 小程序 rich-text 按渲染器分流 + JS 管线按需打包

- **ID**: 050-mp-rich-text-by-renderer
- **状态**: done
- **日期**: 2026-09-14

## 1. 要解决什么

`fjs build --mp` 产出的 vendor 包 `miniprogram/fjs/runtime.ts` 定位是「wx 运行时薄壳 +
reactivity」，现在 4215 行 / 124KB（未压缩），其中约 **1040 行是 rich-text 管线**：

| 模块 | 行数 |
|---|---|
| `rich-text/layout.ts` | 509 |
| `rich-text/parse.ts` | 173 |
| `rich-text/defaults.ts` | 103 |
| `wx/rich-text.ts` | 82 |
| `rich-text/sanitize.ts` / `entities.ts` / `spans.ts` / `warn.ts` | 62 / 56 / 49 / 8 |

来源是 spec 048：skyline 下原生 `<rich-text>` 只渲染有限子集（行内元素各占一行、ol 无编号、
表格挤成一行、img 宽度与 pre 空白失效），于是 `<rich-text>` 一律改写成 runtime 组件
`fjs-rich-text`，在 wx 运行时跑另两端同一条管线。现状有两个问题：

1. **不分渲染器**。webview 渲染器下原生 `rich-text` 本就是 HTML 排版，没有上面那些问题，
   但也照样走 JS 管线、背这 1000 行、节点数更多、长文首帧更慢。
2. **不分用没用**。`wx/index.ts` 无条件 `export { buildWxRichText }` 并挂到
   `globalThis.__fjsWx`，构建入口是 `export *`（`packages/fjs/src/mp/build.ts` 的 esbuild
   stdin），没有任何页面用 `<rich-text>` 的项目也把整条管线打进 `runtime.ts`，
   `fjs-rich-text` / `fjs-rich-node` 两个组件目录也总被拷进产物。

## 2. 不做什么（Non-goals）

- **不改** Flutter / Web 两端（`fjs-runtime/src/rich-text/*`、`components/rich-text.ts`、
  `web/`）。rich-text 契约在两端已成立，本 spec 只动小程序端。
- **不改** skyline 下的渲染效果：skyline 继续走 JS 管线，spec 048 的验收结果保持不变。
- **不做** `runtime.ts` 的其它瘦身（minify、具名导出替代 `export *`、`css/parser` 拆分），
  另开 spec。
- **不做**同一项目内按页面切换渲染器（`app.json` 级 `renderer` 之外的页面级 `renderer`）的分流；
  以 `app.config` 的 `wxmp.renderer` 为准。
- **不追**原生 webview rich-text 与 fjs 管线的像素级一致（默认样式来源不同），差异登记文档。

## 3. 用户可见的行为

页面源码不变：

```vue
<rich-text :nodes="html" space="nbsp" class="article" @tap="onTap" />
```

| `app.config` `wxmp.renderer` | 页面用了 `<rich-text>` | 产物 |
|---|---|---|
| `webview`（默认） | 是 | wxml 里是**原生** `<rich-text nodes space class bindtap>`；`runtime.ts` 不含管线；不拷 `fjs-rich-text` / `fjs-rich-node` |
| `skyline` | 是 | 同现状：改写成 `fjs-rich-text`；管线打成**独立模块**（如 `miniprogram/fjs/rich-text.js`），只由 `fjs-rich-text` 引用；`runtime.ts` 不含管线 |
| 任意 | 否 | 既不生成管线模块，也不拷两个 rich-text 组件；`runtime.ts` 不含管线 |

skyline 下的管线模块只在 `fjs-rich-text` 首次使用时加载（`lazyCodeLoading: requiredComponents`
下组件代码随用到它的页面注入），不再经由 `runtime.ts` 的副作用挂 `globalThis.__fjsWx.buildWxRichText`。

## 4. 各端约定（宪法 I）

Flutter / Web 不变。小程序端两种渲染器：

| | mp · skyline（JS 管线） | mp · webview（原生 rich-text） |
|---|---|---|
| `nodes`（HTML 串 / 节点数组） | 同现状 | 原样传给原生 `nodes`（两者节点形状本就一致，见 `rich-text/types.ts`） |
| `space` | 管线处理 | 原生 `space` |
| `@tap` | 宿主节点 bindtap | 原生 bindtap |
| 默认样式（h1 字号、p 边距、列表缩进…） | `rich-text/defaults.ts` | 原生（浏览器 UA 样式），数值接近但不保证一致 |
| 白名单外标签（script / iframe） | `warnRichTextOnce` 控制台告警 | 原生静默丢弃 → 见待澄清 Q2 |
| 页面 `<style scoped>` 命中内部节点 | 编译器传 `scope`，管线给节点加 data-v class | 原生节点不带 data-v class，scoped 规则命不中 → 见待澄清 Q1 |
| `user-select` / `mode` | 告警不支持（同现状） | 原生支持，直接透传 |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

## 6. 验收标准

1. `pnpm run typecheck`、`pnpm test` 通过；`packages/fjs` 新增单测覆盖：webview 下 `<rich-text>`
   编译为原生 `rich-text`、skyline 下编译为 `fjs-rich-text`。
2. hello-fjs（skyline）`pnpm --filter hello-fjs` 走 `fjs build --mp` 后：
   - `grep -c layoutRichText dist/mp/miniprogram/fjs/runtime.ts` 输出 `0`；
   - `dist/mp/miniprogram/fjs/rich-text.js`（或 plan 定的等价路径）存在且含 `layoutRichText`；
   - `runtime.ts` 行数比现状（4215）少约 1000。
3. hello-fjs（skyline）微信开发者工具打开 `comp/rich-text`：spec 048 第 6 节 rich-text 条目全部仍成立
   （行内同行、ol 编号、表格、img 宽度、pre 空白、scoped class 命中、script/iframe 各告警一次、
   @tap 计数、切换内容、重新挂载）。
4. 把 hello-fjs 的 `wxmp.renderer` 临时改为 `webview` 构建：
   - 产物 `pages/comp/rich-text` 的 wxml 里是 `<rich-text`，不出现 `fjs-rich-text`；
   - 产物里没有 `fjs/fjs-rich-text/`、`fjs/fjs-rich-node/` 目录，也没有管线模块；
   - DevTools 打开 `comp/rich-text`：各块正常排版，@tap 计数 +1，切换内容 / 重新挂载可用。
5. 一个不使用 `<rich-text>` 的项目（`demo`）`fjs build --mp` 后，两种渲染器下均无管线模块、
   无两个 rich-text 组件目录。
6. `docs/miniprogram.md` 的标签映射表与「已知差异」更新为按渲染器分流的描述。

## 7. 待澄清

> 2026-09-14 用户确认：Q1 取 A、Q2 接受并登记、Q3 按建议。

- [x] **Q1 webview 下 scoped 样式命不中原生 rich-text 内部节点，怎么办？**
  hello-fjs 的 rich-text 页有一块专门演示「页面 scoped class 能命中内部节点」。原生 `nodes`
  是 HTML 串时没法在不解析的前提下给节点加 data-v class。
  - 建议 A：接受差异，登记文档（非 scoped 的页面样式仍能命中；要样式化内部节点就别用 scoped）。
    保持 webview 下零管线。
  - 备选 B：webview 下仍对 `nodes` 做一次轻量处理（只加 class，不做 layout），但 HTML 串要解析，
    等于把 `parse.ts` 又带回来。
- [x] **Q2 webview 下 script / iframe 等白名单外标签被原生静默丢弃，是否接受？**
  宪法 V「静默失效是 bug」。建议：接受并在文档已知差异里写明（丢弃行为本身与另两端一致，
  只是没有告警）；如果要告警，就得在 wx 侧解析 HTML，与「webview 零管线」冲突。
- [x] **Q3 skyline 下管线模块的产物形式**：计划做成 plain JS 的 `fjs/rich-text.js`，由
  `fjs-rich-text.js` 直接 `require`（不再经 `globalThis.__fjsWx`）。管线里用到的
  `stringifyStyle` 等会随之复制一份进这个模块（体积小，约几十行）。可以接受吗？
  这是实现层面的问题，你没意见的话 plan 阶段就按这个定。
