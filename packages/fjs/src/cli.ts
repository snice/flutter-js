#!/usr/bin/env node
// fjs — build toolchain CLI for flutter-js.
//
//   fjs build  [--bytecode] [--out dist] [--entry src/main.ts]
//   fjs dev    [--port 38900] [--entry src/main.ts] [--no-qr]
//   fjs create [dir] [--template vue3-vite]
//   fjs run    <android|ios>
import { buildCommand } from './build.js';
import { devCommand } from './dev.js';
import { createCommand } from './create.js';
import { runCommand } from './run.js';

function usage(): never {
  console.log(`fjs — flutter-js toolchain

commands:
  fjs build  [entry]        bundle the app (default entry: src/main.ts)
      --bytecode            also emit <name>.fjsbundle via the fjsc compiler
      --out <dir>           output directory (default: dist)
      --minify              minify the bundle
      --web                 browser build (DOM tags + vue-router) into
                            dist/web, one chunk per page + index.html
      --pages               split build: dist/shared.js (prelude) +
                            dist/bundle.js + dist/pages/<id>.js per route
      --release             with --pages: minify, emit .fjsbundle files and
                            copy them to .fjs/flutter/assets/fjs
      --apk                 with --release: also run flutter build apk
      --flutter-dir <dir>    Flutter host dir for --release/--apk
                            (default: .fjs/flutter)
  fjs dev    [entry]        dev server: HTTP bundle + WebSocket reload
      --port <n>            port (default: 38900, or 5173 with --web)
      --host <addr>          bind address (default: 0.0.0.0)
      --web                 serve the browser build as a static site
      --pages               serve shared.js + bundle.js + pages/<id>.js
      --no-qr               don't draw the QR code of the LAN address
      --no-discovery        don't broadcast this server on the LAN
                            (fjs go's "附近的服务器" list goes quiet)
  fjs create [dir]          scaffold a new fjs app
      --template <name>      template name (default: vue3-vite)
      --list-templates       print available templates
  fjs run <android|ios>      create/reuse .fjs/flutter and run on device
      --device <id>          pass a Flutter device id
      --port <n>             fjs dev port (default: 38900)
      --flutter-dir <dir>    host project dir (default: .fjs/flutter)

env:
  FJSC_PATH                 path to the fjsc bytecode compiler binary
                            (default: ../flutter_jsc/native/build-native/fjsc)
`);
  process.exit(1);
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv.shift();
  switch (cmd) {
    case 'build':
      await buildCommand(argv);
      break;
    case 'dev':
      await devCommand(argv);
      break;
    case 'create':
      await createCommand(argv);
      break;
    case 'run':
      await runCommand(argv);
      break;
    default:
      usage();
  }
}

main().catch((e) => {
  console.error('fjs:', e instanceof Error ? e.message : e);
  process.exit(1);
});
