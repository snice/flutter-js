// The types behind `<image src>` and `<web-view src>`.
//
// A project's local files are a fact the toolchain knows and the editor does
// not: `fjs` scans `public/` and `html/` and writes the paths into the app's
// own `src/fjs-assets.d.ts`, which augments the two empty interfaces below
// (specs/018-src-hints-and-html-dir). Same shape as `FjsRoutes` in
// router/types.ts, and for the same reason — a generated table is the only
// way a d.ts in a published package can know what THIS project ships.
//
// Why types and not a build-time existence check: the check catches a typo
// eventually, the types catch it while it is being typed, and only the types
// answer the question that actually costs time — "what have I got in here?".

export {};

declare global {
  /** Image paths this project ships, as `"/images/x.png": true`. Empty here
   * on purpose: `fjs` generates the augmentation. A project that never
   * generates it keeps plain strings — the types below fall back. */
  interface FjsImageAssets {}

  /** The same for `.html` files, which is what `<web-view>` can open. */
  interface FjsHtmlAssets {}
}

/** Image paths in the generated table, or `string` when there is no table. */
export type FjsImagePath = keyof FjsImageAssets extends never
  ? string
  : Extract<keyof FjsImageAssets, string>;

export type FjsHtmlPath = keyof FjsHtmlAssets extends never
  ? string
  : Extract<keyof FjsHtmlAssets, string>;

// The `(string & {})` half is what keeps these usable. Without it the prop
// would reject every src that is not a literal in the table: an http URL, the
// hashed path an `import png from '…'` returns, a template string built at
// runtime. With it, TypeScript still lists the known paths in completion —
// the union member is what the editor offers — while accepting any string.
// `RoutePathRaw` (router/types.ts) is the same trick for the same reason.

/** A `<image src>`: suggests the project's images, accepts any string. */
export type FjsImageSrc = FjsImagePath | (string & {});

/** A `<web-view src>`: suggests the project's html, accepts any string. */
export type FjsHtmlSrc = FjsHtmlPath | (string & {});
