#!/usr/bin/env node
// fjs — build toolchain CLI for flutter-js.
//
//   fjs build  [--bytecode] [--out dist] [--entry src/main.ts]
//   fjs dev    [--port 38900] [--entry src/main.ts] [--no-qr]
//   fjs create [dir] [--template vue3-vite]
//   fjs create page|component <name>
//   fjs run    <android|ios>
//   fjs routes / fjs doctor
import { buildCommand } from './build.js';
import { devCommand } from './dev.js';
import { createCommand } from './create.js';
import { generateCommand, isGenerator } from './generate.js';
import { routesCommand } from './routes.js';
import { doctorCommand } from './doctor.js';
import { runCommand } from './run.js';

function usage(): never {
  console.log(`fjs — flutter-js toolchain

commands:
  fjs build  [entry]        bundle the app (default entry: src/main.ts)
      --bytecode            also emit <name>.fjsbundle via the fjsc compiler
      --out <dir>           output directory (default: dist)
      --minify              minify non-web bundles; --web does this by default
      --gz                  with --release: gzip copied .fjsbundle assets
      --web                 minified browser build (DOM tags + vue-router)
                            into dist/web, one chunk per page + index.html
      --pages               split build: dist/shared.js (prelude) +
                            dist/bundle.js + dist/pages/<id>.js per route
      --release             emit bytecode and copy release assets to
                            .fjs/flutter/assets/fjs
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
  fjs create page <name>     add src/pages/<name>.vue (also: fjs g page)
                            name may nest and be dynamic: user/[id]
      --title <text>         page title, written to the <route> block
      --tab <n>              tab index, written to the <route> block
      --path <route>         override the derived route path
      --route-name <name>    override the derived route name
      --platform <app|web>   restrict the page to one target (default: both)
      --dry-run / --force    print instead of writing / overwrite
  fjs create component <Name>  add src/components/<Name>.vue
      --dry-run / --force
  fjs routes                 print the route table derived from src/pages
      --platform <app|web>   only routes that target this platform
      --json                 machine-readable output
  fjs doctor                 check toolchain and project setup
  fjs run <android|ios>      create/reuse .fjs/flutter and run on device
      --release              build release assets, then flutter run --release
      --minify               with --release: minify JS before bytecode
      --gz                   with --release: gzip copied .fjsbundle assets
      --no-pages             with --release: build a single bundle
      --device <id>          Flutter device id (default: the first device
                            on that platform; 'flutter devices' lists them)
      --port <n>             fjs dev port (default: 38900)
      --flutter-dir <dir>    host project dir (default: .fjs/flutter)

env:
  FJSC_PATH                 path to the fjsc bytecode compiler binary
                            (default: the @ufjs/fjsc-<platform> package npm
                            installs alongside this one)
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
    case 'generate':
    case 'g': {
      // `fjs create page about` generates a file; `fjs create my-app` still
      // scaffolds a project. `g` is the generator-only alias.
      const kind = argv[0];
      if (kind && isGenerator(kind)) {
        generateCommand(kind, argv.slice(1));
      } else if (cmd === 'create') {
        await createCommand(argv);
      } else {
        throw new Error(`fjs ${cmd} takes one of: page, component`);
      }
      break;
    }
    case 'routes':
      routesCommand(argv);
      break;
    case 'doctor':
      doctorCommand(argv);
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
