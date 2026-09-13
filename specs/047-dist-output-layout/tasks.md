# Tasks: 047-dist-output-layout

- [x] `buildCommand`（`packages/fjs/src/bundler/build.ts`）：非 web 构建的
      outDir 追加 `app/` 子目录（`--out` 语义变为"输出根"），web 路径不动
- [x] 修订：子目录逻辑下沉到 `parseBuildArgs`，`fjs dev` / `fjs run`（debug）
      的产物同样落 `dist/app/`；`buildCommand` 里的重复逻辑移除
- [x] 修订：`fjs dev` 的文件监听排除改为按 outDir 解析路径前缀匹配
      （`dev/server.ts`），`src/app/` 不再被 basename 误伤；实测
      `src/main.ts` 与 `src/app/probe.ts` 改动都能触发重建
- [x] `fjs run --release`（`packages/fjs/src/commands/run.ts`）：中间构建
      产物同样落到 `dist/app/`
- [x] CLI 帮助文本（`packages/fjs/src/cli.ts`）：`--out` 与 `--pages` 的
      路径说明
- [x] create 模板注释（`packages/fjs/src/commands/create.ts`）
- [x] `examples/bench/package.json`：fjsrun 路径改 `dist/app/bundle.js`
- [x] 文档：toolchain / routing / code-splitting / performance /
      jsi-and-native-modules / roadmap / 顶层 README / AGENTS /
      examples/hello-fjs/README 的产物路径
- [x] 验收：demo `build` → `dist/app/bundle.js`；`build:pages` →
      `dist/app/{shared,bundle}.js + pages/*`；`build:web`（vite）→ `dist/web`
- [x] 验收：hello-fjs `build:web:fjs` → `dist/web`；`build` → `dist/app`
- [x] 验收：`fjs build --out X` → `X/app`
- [x] 验收：`fjs dev --pages` → `dist/app/{shared,bundle}.js + pages/*`，
      `dist/` 根无散落文件，HTTP `/bundle.js` `/pages/index.js` 正常
- [x] 验收：`pnpm test`（61 个测试文件全过）、`pnpm run typecheck` 全过
