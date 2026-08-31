#!/usr/bin/env node
// fjs — build toolchain CLI for flutter-js.
//
//   fjs build  [--bytecode] [--out dist] [--entry src/main.ts]
//   fjs dev    [--port 38900] [--entry src/main.ts] [--no-qr]
//   fjs create [dir] [--template vue3-vite]
//   fjs create page|component <name>
//   fjs run    <android|ios>
//   fjs routes / fjs doctor / fjs devices / fjs clean / fjs host / fjs icon
//   fjs log / fjs eval
import { buildCommand } from './build.js';
import { devCommand } from './dev.js';
import { createCommand } from './create.js';
import { generateCommand, isGenerator } from './generate.js';
import { routesCommand } from './routes.js';
import { devicesCommand } from './devices.js';
import { cleanCommand } from './clean.js';
import { hostCommand } from './host.js';
import { iconCommand } from './icon.js';
import { evalCommand, logCommand } from './inspect.js';
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
      --analyze             print a size report: per-artifact js/gzip/
                            bytecode sizes and the packages inside them
      --pages               split build: dist/shared.js (prelude) +
                            dist/bundle.js + dist/pages/<id>.js per route
      --release             emit bytecode and copy release assets to
                            .fjs/flutter/assets/fjs
      --apk                 with --release: also run flutter build apk
      --flutter-dir <dir>    Flutter host dir for --release/--apk
                            (default: .fjs/flutter, or package.json
                            fjs.flutterDir once ejected)
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
  fjs devices                android/ios devices fjs run can see
      --json                 machine-readable output
  fjs host [status]          the Flutter host: where it is, who owns it
      create                 create it without running the app
      open <android|ios>     open it in Android Studio / Xcode
      eject [dir]            move it into the repo (default: flutter/) and
                            stop regenerating its Dart and pubspec
      sync [--force]         re-apply the generated host files
      id [<app.id>]          print or set applicationId / bundle identifier
  fjs icon <file.png>        regenerate the app icons from one square PNG
      --platform <android|ios>  only that platform (default: both)
      --dry-run              list the files and sizes instead
  fjs log                    stream the app's console output
      --port <n>             dev server port (default: 38900)
      --host <addr>          dev server address (default: 127.0.0.1)
  fjs eval <expression>      evaluate an expression in the running VM
      --timeout <ms>         how long to wait for the answer (default: 5000)
  fjs clean                  remove generated output
      --out <dir>            build output directory (default: dist)
      --flutter-dir <dir>    Flutter host dir (default: .fjs/flutter)
      --all                  also remove the Flutter host itself
      --dry-run              print what would be removed
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
      await doctorCommand(argv);
      break;
    case 'devices':
      devicesCommand(argv);
      break;
    case 'clean':
      cleanCommand(argv);
      break;
    case 'host':
      hostCommand(argv);
      break;
    case 'icon':
      iconCommand(argv);
      break;
    case 'log':
      await logCommand(argv);
      break;
    case 'eval':
      await evalCommand(argv);
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
