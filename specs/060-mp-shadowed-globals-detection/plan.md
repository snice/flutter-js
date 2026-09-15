# Plan: 小程序 shadowed globals 注入判定要看代码，不要看注释

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 不涉及 | 只动小程序编译的一步文本判定 |
| II 边界即契约 | 不涉及 | |
| III 同步单线程 | 不涉及 | |
| IV WeUI | 不涉及 | |
| V 静默失效是 bug | 涉及 | 这条 bug 的本质就是静默跳过；修完的判定只在"代码里真的绑定了这个名字"时才跳过 |
| VI 注释记录权衡 | 涉及 | 剥注释/字符串的扫描器里记下为什么不上真解析器、正则字面量怎么处理 |
| VII JS 能包 | 不涉及 | |
| VIII 文档 | 部分 | 行为没有对外变化（修的是误判），docs 不动 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI | `packages/fjs/src/mp/script.ts` | `shadowedGlobalsImport`：先剥注释与字符串，再判定；"已绑定"改成真的绑定形式（声明 / `import {…}` / 默认与命名空间导入）|
| 测试 | `packages/fjs/test/mp-shadowed-globals.test.ts` | 新建：注释、字符串、模板串、真导入、真声明、无关代码 |

不动：`SHADOWED_GLOBALS` 名单、vendor banner、注入的 import 形状。

## 3. 方案

```ts
shadowedGlobalsImport(code)
  const bare = stripCommentsAndStrings(code)   // 注释→空格，字符串体→空
  used      = /\bg\b/.test(bare)
  declared  = /(function|const|let|var|class)\s+g\b/
            | /import\s*\{[^}]*\bg\b[^}]*\}/
            | /import\s+(g\b|\*\s+as\s+g\b)/
```

- `stripCommentsAndStrings` 是一个手写扫描器（约 40 行）：`//`、`/* */`、
  `'` `"` `` ` ``（含转义；模板串里的 `${}` 保留代码）。**不做**正则字面量
  识别 —— 需要判断上一个有意义 token 才能区分除号，代价远大于收益；`//`
  出现在正则字面量里必然是 `\/\/`（转义），扫描器看到的是 `\/`，不会误当注释。
- 用法侧仍是 `\bg\b`（`globalThis.requestAnimationFrame` 也算用到）：多注入
  一行未使用的 import 是无害的，而漏注入是真机崩溃 —— 不对称，取保守的一侧。
- esbuild 的 transform 也能剥注释，但这一步跑在 SFC 源码文本上、在 esbuild
  之前，且是同步函数；为一次文本判定拉一次异步 transform 不划算。

## 4. 风险

- 扫描器把代码剥坏会让判定整体失准。用例覆盖 `//` `/* */` `'` `"` `` ` ``
  与转义；产物层面用 `build:mp` 对 hello-fjs 全量回归。

## 5. 验证路径

```bash
pnpm --filter @ufjs/cli test
pnpm test
pnpm --filter @ufjs/cli run build        # fjs bin 跑 dist
pnpm --filter hello-fjs run build:mp
```
