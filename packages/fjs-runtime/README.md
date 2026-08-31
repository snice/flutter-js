# @ufjs/runtime

JS runtime for [flutter-js](https://github.com/snice/flutter-js). Provides the
element API, the batched binary UI-op protocol spoken with the `flutter_fjs`
native host, and a Vue 3 custom renderer that maps HTML-like tags onto Flutter
widgets.

Published as TypeScript source — it is compiled by
[`@ufjs/cli`](https://www.npmjs.com/package/@ufjs/cli), which is how you should
consume it:

```bash
npm i -D @ufjs/cli @ufjs/runtime
```

Inside an app you import it through the `fjs` aliases the toolchain sets up:

```ts
import { createFjsApp } from 'fjs/app';
import { toast, Worker, nowMs } from 'fjs';
```

## Entry points

| Export | Contents |
| --- | --- |
| `.` | element API, host bridge, `toast`, `Worker`, timing |
| `./vue` | Vue 3 custom renderer |
| `./router` | vue-router integration with native navigation |
| `./app` | `createFjsApp` bootstrap |
| `./web` | DOM fallback so the same app runs in a browser |
| `./volar` | Volar plugin for tag typing in SFC templates |

## Editor setup

```json
{
  "vueCompilerOptions": { "plugins": ["@ufjs/runtime/volar"] }
}
```

MIT
