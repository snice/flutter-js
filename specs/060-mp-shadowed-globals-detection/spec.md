# Spec: 小程序构建的 shadowed globals 注入判定要看代码，不要看注释

- **ID**: 060-mp-shadowed-globals-detection
- **状态**: done
- **日期**: 2026-09-16

## 1. 要解决什么

小程序的模块包装会用自己的（undefined）`requestAnimationFrame` /
`cancelAnimationFrame` 绑定遮蔽全局，所以 `fjs build --mp` 给每个用到这两个
名字的模块注入一行 `import { … } from '@ufjs/runtime/wx'`
（[`packages/fjs/src/mp/script.ts`](../../packages/fjs/src/mp/script.ts)
的 `shadowedGlobalsImport`）。

判定是对**整份源码文本**跑两条正则：

```ts
new RegExp(`\\b${g}\\b`).test(code) &&
!new RegExp(`(function|const|let|var)\\s+${g}\\b|import[^;]*\\b${g}\\b`).test(code)
```

第二条（"它自己已经声明/导入了"）不区分代码和注释、字符串。spec 059 的
`examples/hello-fjs/src/leafer/platform.ts` 里有一句普通中/英文注释：

> the mini program build **imports** the wx runtime's one into this module

`import` 与随后几行代码里的 `requestAnimationFrame` 之间没有分号，
`import[^;]*\brequestAnimationFrame\b` 因此命中，注入被跳过。**构建、类型检查、
开发者工具的脚本加载全都不报错**，只有真机运行到那一行才抛
`TypeError: requestAnimationFrame is not a function`（用户报告）。

同一条正则还会被这些写法骗到：注释里提到 `const requestAnimationFrame`、
字符串 `'requestAnimationFrame'`、`import` 语句后面跟着（分号之后）出现的用法
是否被吃掉也取决于分号风格。

## 2. 不做什么（Non-goals）

- 不改小程序模块包装本身的行为（遮蔽是宿主定的，不是 fjs 能取消的）。
- 不引入完整 JS 解析器做这个判断（esbuild 已在依赖里，但这一步跑在
  esbuild 之前的源码文本上；先看剥注释/字符串够不够）。
- 不扩大 `SHADOWED_GLOBALS` 的名单。

## 3. 用户可见的行为

页面或本地模块里怎么写注释都不影响注入：只有**代码里真的**声明或导入了这个
名字时，编译器才不注入。误判导致的失败必须在构建期就能看见，而不是等真机。

```ts
// 注释里随便写 "the build imports requestAnimationFrame for you"
raf = requestAnimationFrame(tick);   // ← 仍然要被注入 wx 运行时的实现
```

## 4. 三端约定（宪法 I）

只影响小程序编译（`packages/fjs/src/mp`），Flutter / Web 侧不变。

## 5. 契约变更（宪法 II）

- [x] 都不涉及

## 6. 验收标准

1. `packages/fjs/test/` 新增用例：源码里只有注释/字符串提到 `import
   requestAnimationFrame`，仍然注入；真的 `import { requestAnimationFrame }
   from …` 或 `const requestAnimationFrame = …`，不注入。
2. `pnpm test` 通过。
3. `pnpm --filter hello-fjs run build:mp` 后，
   `dist/mp/miniprogram/fjs/shared/leafer/platform.ts` 与各游戏页的产物里，
   用到这两个名字的模块都带注入行（本 spec 落地后，059 的
   `platform.ts` 可以把 `globalThis` 取法换回裸标识符，但不是必须）。

## 7. 待澄清

- 剥注释与字符串的实现选型（手写扫描 vs. 复用 esbuild transform 的结果），
  留给 `/plan`。
