# @ufjs/cli

## 0.1.3

- Local image assets. `public/` is served by `fjs dev` and copied into the
  bundle for release, so `<image src="/images/x.png">` resolves the same way in
  dev, in a web build, and on device. `import png from './x.png'` inside `src/`
  works too — the bundler emits the file and rewrites the specifier to its
  hashed path.
- `html/` at the project root is where an app's own `<web-view>` pages live,
  reachable at `/html/<file>.html`. Before this there was no legal way to write
  a local html page: `classifySrc` only knew http URLs and `asset://` (files a
  module ships). The directory name stays in the URL on purpose — `public/` and
  `html/` would otherwise share the root namespace, and a collision there is a
  silent overwrite rather than an error.
- `public/` and `html/` are scanned into `src/fjs-assets.d.ts`, so `<image src>`
  completes the project's images and `<web-view src>` its html files, each from
  its own table. The types are `keyof X | (string & {})`, which keeps http URLs,
  `import`ed paths and template strings accepting; a typo is therefore not a
  type error, so a separate build-time check looks at literal `src` values and
  names the closest candidate. Dynamic `:src` is left alone.
- New `@ufjs/cli/vite` plugin export: the same Vue/pages app runs as an ordinary
  browser app under Vite dev and build, with the fjs pages router, plugins,
  module aliases and CSS compat wired in.
- A module's files are no longer copied into the app's `public/fjs-modules/`.
  `.fjs/modules/<name>/` is the single copy; the vite plugin (dev) and the web
  build give it a URL, and the `/fjs-modules/<name>/<file>` contract is
  unchanged. The old copy was a `prepare` hook writing outside `outDir`, and
  once `public/` started going into the package wholesale it was a duplicate
  file in every release build that the app side never read.
- The vite middleware returns 404 for a miss under its own prefixes instead of
  falling through to the SPA index. `/html/nope.html` used to answer 200 with
  `index.html`, which inside a `<web-view>` looks like the app rendering itself
  into a box and says nothing about what went wrong.
- `<canvas>` is a known native tag in the Vue plugin, and the Flutter host
  resolution used by `fjs build` was tightened (`test/flutter-resolve.test.ts`).

## 0.1.2

- Flutter host configuration through `app.config.ts`.

## 0.1.1

- `fjs module`: one package carrying a JS API, Vue components, Flutter widgets
  and its autolink entry.
- Android builds honour `--target-platform`.

## 0.1.0

- First release.
