# demo

Vue 3 + Vite fjs app. 首页位于 `src/pages/index.vue`，默认文本是 `hello-fjs`。

## Develop

```bash
pnpm install
pnpm run dev:web      # browser via Vite
pnpm run run:android  # Flutter Android host, created under .fjs/flutter
pnpm run run:ios      # Flutter iOS host, created under .fjs/flutter
pnpm run typecheck
```

## Build

```bash
pnpm run build
pnpm run build:bytecode
pnpm run build:pages
pnpm run build:web
pnpm run build:release  # split bytecode copied to .fjs/flutter/assets/fjs
pnpm run build:apk      # also runs flutter build apk
```

Pass Flutter build arguments after `--`:

```bash
pnpm run build:apk -- --debug
```
