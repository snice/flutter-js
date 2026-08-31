# @ufjs/cli

Build toolchain for [flutter-js](https://github.com/snice/flutter-js) — bundles
TypeScript / JavaScript / Vue 3 SFC apps into a bundle the `flutter_fjs` Flutter
runtime can execute (source or QuickJS bytecode).

Ships the `fjs` binary.

```bash
npm i -D @ufjs/cli @ufjs/runtime
npx fjs create my-app
```

## Commands

| Command | What it does |
| --- | --- |
| `fjs create <name>` | Scaffold a new project (Vue 3 + Vite, or plain TS) |
| `fjs dev` | Dev server with hot reload, prints a QR code for the fjs-go app |
| `fjs build` | Bundle for production (`--bytecode`, `--pages`, `--release`, `--apk`) |
| `fjs run android` / `fjs run ios` | Build and launch on a device |

## Vite plugin

```ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fjs } from '@ufjs/cli/vite';

export default defineConfig({ plugins: [fjs(), vue()] });
```

App code imports the runtime as `fjs` / `fjs/vue` / `fjs/router` / `fjs/app` /
`fjs/web` — those specifiers are resolved by this toolchain onto
[`@ufjs/runtime`](https://www.npmjs.com/package/@ufjs/runtime).

MIT
