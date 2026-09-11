# Tasks: Anime.js 示例页

- [x] T1 `pnpm --filter hello-fjs add animejs@4.5.0`
- [x] T2 `src/anime/native-polyfills.ts`：App 端 `setImmediate` → `requestAnimationFrame`
- [x] T3 `src/pages/example/anime.vue`：stagger 网格 / 时间轴 + 播放控制 / 缓动对比 + 计数器
- [x] T4 `catalog.ts` 加「动画演示」分组；README 登记
- [x] T5 `pnpm --filter hello-fjs run typecheck`
- [x] T6 `build:pages` + `build:web`
- [x] T7 web 预览验证（动画在动、重播/暂停生效、控制台干净）
- [x] T8 iOS 模拟器验证（无 `setImmediate` 报错；网格逐帧在变、时间轴跑完、缓动/计数器到位）
- [x] T9 Android 模拟器验证（Pixel 9 Pro；页面挂载无报错，前后两帧画面在变）
