# Tasks: app.config.ts 的 version 同步进宿主 pubspec

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 `AppConfig` 增加 `version?: string` 并在 `validateAppConfig` 白名单校验（`packages/fjs/src/project/config.ts`）
- [x] T002 `packages/fjs/types/config.d.ts` 镜像同步

## 实现

- [x] T010 `writeHostPubspec` 增加 version 参数（默认 `1.0.0+1`）并在模板插值（`packages/fjs/src/commands/run.ts`）
- [x] T011 `ensureFlutterHost` 调用点传入 `appConfig.version`

## 两端对齐

- [x] T020 确认不涉及 UI op、JSI/FFI 或事件契约（spec 015 同款结论：宿主工程配置，Web 无对应物）

## 测试

- [x] T030 `config.test.ts`：version 合法值通过、非法值报错、缺省不产生字段
- [x] T031 `run.test.ts`：writeHostPubspec 生成带配置 version 的 pubspec / 缺省时 `1.0.0+1`

## 文档

- [x] T040 更新 `docs/toolchain.md`（原生应用配置段：示例加 version + 边界说明）
- [x] T041 `docs/roadmap.md` 宿主配置清单补一笔

## 验收

- [x] T050 `pnpm --filter @ufjs/cli run typecheck`
- [x] T051 `pnpm --filter @ufjs/cli run test` 与 `pnpm test`
- [x] T052 hello-fjs 现有 `version: '1.0.0+2'` 能被 `readAppConfig` 解析出来，且真实 `fjs host create` 后 pubspec version 行为 `1.0.0+2`
- [x] T053 spec.md 第 6 节逐条核对
