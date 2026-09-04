// The module's build step. fjs runs this before every build, dev start and
// Vite start, because package.json says `"fjs": { "prepare": "./prepare.mjs" }`.
//
// What it does is copy this module's `public/` — the pages it ships — to
// where each target can SERVE them. That is the difference between this hook
// and iconmind's: icons are data a widget reads, these are documents a
// browser fetches over HTTP, so they have to end up behind a URL.
//
//   .fjs/modules/webview/<file>        both targets' source of truth
//     → app dev:     `fjs dev` already serves /modules/webview/<file>
//     → app release: the build copies it to assets/fjs/modules/webview/
//     → web:         copied AGAIN, into the app's own public/ (see below)
//
// The web copy writes OUTSIDE ctx.outDir, which no other hook does. It is
// deliberate: vite does not serve `.fjs/`, and the app's public directory is
// the only place a file can land and be reachable at a stable URL in both
// `vite dev` and `vite build` without the app editing its vite config. The
// path is fixed at public/fjs-modules/<module>/ so it is obvious where it
// came from and safe to delete. See docs/modules.md.
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

  if (ctx.platform === 'web') {
    const target = path.join(ctx.root, 'public', 'fjs-modules', MODULE);
    fs.mkdirSync(target, { recursive: true });
    for (const name of files) {
      const to = path.join(target, name);
      const contents = fs.readFileSync(path.join(source, name));
      // Same "skip an unchanged write" rule ctx.write follows: the dev
      // server watches these trees, and a rewrite is a reload.
      if (fs.existsSync(to) && fs.readFileSync(to).equals(contents)) continue;
      fs.writeFileSync(to, contents);
    }
    ctx.log(`${files.length} page(s) → public/fjs-modules/${MODULE}/`);
    return;
  }

  ctx.log(`${files.length} page(s) → .fjs/modules/${MODULE}/`);
}
