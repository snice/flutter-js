# Spec: dist 按目标平台分目录（dist/app、dist/web）

- **ID**: 047-dist-output-layout
- **状态**: done
- **日期**: 2026-09-13

## 1. 要解决什么

`fjs build`（App 产物）默认直接落在 `dist/` 根目录，而 `fjs build --web`
落在 `dist/web/`。两个目标的产物混在同一棵树里：web 构建一清空 `dist/web`
还好，但 App 产物和将来任何第三种目标（小程序，见 046-vue-to-miniprogram）
都没有各自的子目录，`fjs build` 与 `fjs build --web` 的产物只能靠文件名区分，
`vite build`（模板里 outDir 是 `dist/web`）清目录时还要小心别把 App 产物一起删掉。

期望的布局：

```
dist/
  app/    ← fjs build（含 --pages / --bytecode / --release）
  web/    ← fjs build --web（现状，不变）
  mp/     ← fjs build --mp（不做，属 046-vue-to-miniprogram）
```

## 2. 不做什么（Non-goals）

- **`fjs build --mp`**：属 spec 046-vue-to-miniprogram，本 spec 只把目录布局
  留好位置，不实现。
- **`fjs clean` 不变**：默认删整个 `dist/`，天然覆盖 `dist/app` 与 `dist/web`。
- **web 构建路径不变**：`buildWeb` 一直是"outDir 下再拼 `web/`"，`--web`
  的所有行为保持原样。

> 修订（2026-09-13，实现后发现）：初版把 `fjs dev` 划在范围外，理由是 dev 的
> 文件监听按 basename 排除 outDir、`app` 会误伤 `src/app/`。但 `fjs run`（默认
> debug 模式）spawn 的就是 `fjs dev --pages`，产物仍散在 `dist/` 根，与
> `dist/app` 并存，用户实测立刻暴露。修正：平台子目录下沉到 `parseBuildArgs`
> （build/dev 共用），dev 的监听排除改为按 outDir 的**解析路径前缀**匹配，
> `src/app/` 不再受影响。

## 3. 用户可见的行为

```bash
fjs build              # → dist/app/bundle.js（原来是 dist/bundle.js）
fjs build --pages      # → dist/app/shared.js + dist/app/bundle.js + dist/app/pages/*
fjs build --bytecode   # → dist/app/bundle.fjsbundle
fjs build --release    # → dist/app/*  + 拷贝到 Flutter host assets/（不变）
fjs build --web        # → dist/web/（不变）
fjs build --out X      # → X/app（app 构建）/ X/web（web 构建）
                       #   --out 是"输出根"，平台子目录永远附加
fjs dev / fjs run      # dev server 的产物与 build 同目录：dist/app/*
                       # （bundle.js / pages/…），HTTP 路径不变
fjs run android --release  # 中间产物同样落在 dist/app/，之后拷贝不变
```

`fjsrun` 等直接吃 bundle 文件的调试工具，路径从 `dist/bundle.js` 变为
`dist/app/bundle.js`（`examples/bench` 的 run 脚本、docs 里的示例同步改）。

## 4. 两端约定（宪法 I）

不涉及页面可见能力，两端同源不受影响。Web 侧唯一相关的是 `dist/web` 位置不变，
模板 `vite.config.ts` 的 `build.outDir: 'dist/web'` 不用动。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及 —— 纯 CLI 输出布局，运行时协议零改动

## 6. 验收标准

1. `cd demo && pnpm run build`：产物在 `demo/dist/app/bundle.js`，
   `dist/` 根下不再出现 `bundle.js`。
2. `cd demo && pnpm run build:pages -- --release`（或 hello-fjs
   `build:release`）：`dist/app/{shared,bundle}.fjsbundle` +
   `dist/app/pages/*`，Flutter host 的 `assets/fjs/manifest.json` 照常生成。
3. `cd examples/hello-fjs && pnpm run build:web:fjs`：产物仍在
   `dist/web/`（index.html + 分页 chunk），测试
   `packages/fjs/test/assets.test.ts` 的 web 断言照常命中。
4. `pnpm test`、`pnpm run typecheck` 通过。
5. `fjsrun dist/app/bundle.js`（examples/bench 的 run 脚本）能跑。

## 7. 待澄清

- 无。`--mp` 明确归 046，dev 输出位置不动（理由见第 2 节）。
