# Tasks: hello-fjs 增加 LeaferJS 示例 —— 消消乐（三端含小程序）

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 实现

- [x] T010 `package.json` 加 `@leafer-ui/miniapp@2.2.10`
- [x] T011 新建 `src/leafer/platform.ts`
- [x] T012 新建 `src/pages/example/game/leafer-match3.vue`（原名 match3-leafer，
      被 `fjs.mp.exclude` 的子串匹配误排除，改名）
- [x] T013 README 补一行

## 三端对齐

- [x] T020 Web 走查：渲染、拖动交换 → 消除 → 下落 → 计分 3，console 无错
- [x] T021 iOS 模拟器（iPhone 17 Pro，`fjs run ios` dev）：渲染、拖动交换 → 计分 4。
      首轮圆角方块/棋盘底板不上屏：App 端 context 的 `roundRect` 是 ❌ 占位，
      Leafer 绑定了它；适配层改为非浏览器/非 wx context 一律补 arcTo 实现
- [x] T022 `build:mp` 通过，产物含 `pages/example-game-leafer-match3`，vendor 含 Leafer；
      DevTools 中页面脚本加载无异常，但开发者工具不支持 Skyline canvas 调试，
      画面需**真机**验证（未做）

## 验收

- [x] T050 typecheck 通过
- [x] T051 `pnpm test`：fjs 218 / runtime 465 / webgl 30 全绿
- [ ] T052 小程序真机走查（用户侧）
