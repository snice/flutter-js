# Plan: app.config.ts 的屏幕方向锁定

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 否 | 宿主工程配置，spec 015 同款边界；web/mp 差异记入非目标 |
| II 边界即契约 | 否 | 不动 op 协议、JSI、事件 |
| III 同步单线程零序列化 | 否 | 纯 CLI 文本生成 |
| IV 外观照 WeUI | 否 | 不涉及 UI |
| V 静默失效是 bug | 是 | 非法 orientation 报错；模板键/activity 找不到时 throw；iPad 方向锁自动补 `UIRequiresFullScreen`，不让它静默无效 |
| VI 注释记录权衡 | 是 | `sensorLandscape` 的选择、`UIRequiresFullScreen` 的 iPad 多任务原因写进注释 |
| VII JS 能包就不要下 Dart | 否 | 不涉及运行时能力；原生声明比 Dart 运行时更早生效 |
| VIII 变更落到文档 | 是 | `docs/toolchain.md`、`docs/roadmap.md` |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | `packages/fjs/src/project/config.ts` | `AppOrientation` 类型、`AppConfig.orientation`、校验分支 |
| CLI / 构建 | `packages/fjs/types/config.d.ts` | 镜像同步 |
| CLI / 构建 | `packages/fjs/src/commands/run.ts` | `syncNativeHostConfig` 内：manifest activity upsert `screenOrientation`；plist 方向数组就地改写；`UIRequiresFullScreen` 并入 marker 通道 |
| 测试 | `packages/fjs/test/config.test.ts`、`packages/fjs/test/run.test.ts` | 校验与两端注入的用例 |
| 示例 | `examples/racing/app.config.ts` | `orientation: 'landscape'` |
| 文档 | `docs/toolchain.md`、`docs/roadmap.md` | 字段说明与清单补笔 |

## 3. 方案

沿用 spec 015 的宿主配置通道，在 `syncNativeHostConfig` 内按平台注入：

- **Android**：在含 `MainActivity` 的 `<activity>` 开标签内 upsert
  `android:screenOrientation`——有该属性则替换值，没有则在开标签收尾 `>` 前
  插入一行（模板属性为每行一个、4 空格缩进）。activity 是元素开标签，其
  属性区不受子元素（intent-filter）影响；正则只作用于开标签文本。找不到
  含 MainActivity 的开标签时 throw（宪法 V）。
- **iOS**：模板的两组方向键在 marker 区块之外，直接对
  `/(<key>UISupportedInterfaceOrientations(~ipad)?<\/key>\s*<array>)[\s\S]*?(<\/array>)/g`
  就地改写数组内容（`\t\t` 缩进序列化，复用 plist 字符串转义）；一个键都
  匹配不到时 throw。**不能走 infoPlist marker 通道**——会在 plist 里产生
  重复键（行为未定义）。`UIRequiresFullScreen: true` 不在模板里，走现有
  marker 通道并入 `values`（用户 `ios.infoPlist` 可覆盖）。
- **不配置时**：两个平台都不动文件，与既有"没配的字段保持 Flutter 默认"
  语义一致。

被否掉的备选：

- **`SystemChrome.setPreferredOrientations` 写进生成 main.dart**——生效晚于
  启动画面（竖屏闪一下才转过来），且 main.dart 是"缺失才写"，模板 churn 会
  覆盖用户手改；原生声明是 spec 015 的既有层。
- **iOS 方向键走 marker 区块 + 删模板键**——删完之后再想"取消配置还原默认"
  就没有载体了；就地改写让模板始终保有这两个键，行为可预期。
- **暴露 Android 全部 screenOrientation 枚举**——跨平台语义对齐优先，多余
  枚举值在 iOS 侧没有对应物，违反宪法 I 的精神。

## 4. 风险

- flutter create 模板漂移（不同版本键排序/缩进不同）：正则用 `\s*` 容忍
  空白差异；键缺失时 throw 而不是静默跳过。
- activity 开标签内属性值包含 `>` 的情况：模板不存在此类值；即使出现，
  开标签边界取第一个 `>`，MainActivity 属性匹配仍在其内。
- `UIRequiresFullScreen` 与用户显式配置冲突：用户 `ios.infoPlist` 同名键
  后展开、胜出，语义可预期。

## 5. 验证路径

```bash
pnpm --filter @ufjs/cli run typecheck
pnpm --filter @ufjs/cli run test && pnpm test
pnpm --filter @ufjs/cli run build
cd examples/racing && pnpm exec fjs host create
grep screenOrientation .fjs/flutter/android/app/src/main/AndroidManifest.xml
grep -A4 UISupportedInterfaceOrientations .fjs/flutter/ios/Runner/Info.plist
```
