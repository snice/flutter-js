// The module's build step. fjs runs this before every build, dev start and
// Vite start, because package.json says `"fjs": { "prepare": "./prepare.mjs" }`.
//
// It copies this module's `public/` — the pages it ships — into the one
// place both targets read from:
//
//   .fjs/modules/webview/<file>        the only copy
//     → app dev:     `fjs dev` serves /modules/webview/<file>
//     → app release: the build copies it to assets/fjs/modules/webview/
//     → web:         the fjs vite plugin serves it at /fjs-modules/webview/,
//                    and the web builds copy it to the same path
//
// It used to write a SECOND copy into the app's own `public/fjs-modules/` —
// the only hook that ever wrote outside ctx.outDir — because that was the
// one place vite would serve it from without the app editing its config.
// Once `public/` started riding into the Flutter bundle wholesale
// (specs/017-local-image-assets), that second copy became a duplicate file
// in every release build, and the app side never read it. The toolchain now
// gives the one copy its web URL instead (specs/018-src-hints-and-html-dir),
// so a hook is back to writing only where it should.
import fs from 'node:fs';
import path from 'node:path';

const MODULE = 'webview';

export default async function prepare(ctx) {
  const source = path.join(ctx.module.dir, 'public');
  if (!fs.existsSync(source)) return;

  const files = fs
    .readdirSync(source, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);

  for (const name of files) {
    ctx.write(name, fs.readFileSync(path.join(source, name), 'utf8'));
  }

  ctx.log(`${files.length} page(s) → .fjs/modules/${MODULE}/`);
}
