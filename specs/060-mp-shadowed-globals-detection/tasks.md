# Tasks: 小程序 shadowed globals 注入判定要看代码，不要看注释

对应 plan：`./plan.md`。

## 实现

- [x] T010 `packages/fjs/src/mp/script.ts`：`stripCommentsAndStrings` +
      `bindsName`（声明 / 命名导入 / 默认导入 / 命名空间导入）
- [x] T011 `packages/fjs/test/mp-shadowed-globals.test.ts`：10 条用例 ——
      注释、块注释、字符串、模板串、模板表达式、真 import 四种形态、
      真声明、正则字面量
- [x] T012 spec 059 的 `src/leafer/platform.ts` 注释更新（仍走 globalThis：
      不依赖这一步注入更稳，注释说明原委）

## 验收

- [x] T050 `pnpm test`：fjs 228（+10）/ runtime 465 / webgl 30 / webview 36 全绿；
      `pnpm run typecheck` 全 workspace 通过
- [x] T051 `pnpm --filter @ufjs/cli run build` + `build:mp`：
      `fjs/shared/leafer/platform.ts` 现在带注入行（修复前没有），
      f2 适配层与各游戏页照旧；开发者工具加载无异常（canvas 仍需真机）
- [x] T052 spec 第 6 节逐条核对

## 实施记录

- 扫描器最初的注释声称"正则字面量里的 `//` 必然被转义、不会误判"——
  自己的用例证伪：`/\//` 的转义斜杠与收尾斜杠正好相邻。改成「`//` 前面是
  反斜杠就不当注释」，注释一并改正。
