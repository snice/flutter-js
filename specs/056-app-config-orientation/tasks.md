# Tasks: app.config.ts 的屏幕方向锁定

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 `AppOrientation` 类型、`AppConfig.orientation` 字段与 `validateAppConfig` 枚举校验（`packages/fjs/src/project/config.ts`）
- [x] T002 `packages/fjs/types/config.d.ts` 镜像同步

## 实现

- [x] T010 Android：MainActivity `<activity>` 开标签 upsert `android:screenOrientation`（`packages/fjs/src/commands/run.ts`）
- [x] T011 iOS：`UISupportedInterfaceOrientations` / `~ipad` 数组就地改写，键缺失时 throw
- [x] T012 iOS：`UIRequiresFullScreen: true` 并入 marker 通道（用户 infoPlist 可覆盖）

## 两端对齐

- [x] T020 确认不涉及 UI op、JSI/FFI 或事件契约；web/mp 差异记入 spec 非目标

## 测试

- [x] T030 `config.test.ts`：orientation 合法值通过、非法值报错
- [x] T031 `run.test.ts`：landscape/portrait 的 manifest 属性与 plist 数组、幂等、未配置不动文件

## 示例与文档

- [x] T040 `examples/racing/app.config.ts` 加 `orientation: 'landscape'`
- [x] T041 更新 `docs/toolchain.md`（示例 + 映射 + 还原方式）
- [x] T042 `docs/roadmap.md` 宿主原生配置清单补一笔

## 验收

- [x] T050 `pnpm --filter @ufjs/cli run typecheck`
- [x] T051 `pnpm --filter @ufjs/cli run test` 与 `pnpm test`
- [x] T052 racing 真实 `fjs host create` 后 manifest/plist 端到端核对（plutil -lint OK）
- [x] T053 spec.md 第 6 节逐条核对
