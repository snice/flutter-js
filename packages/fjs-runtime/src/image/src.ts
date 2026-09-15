/** The web half of the one src shape the bundler produces
 * (specs/017-local-image-assets).
 *
 * `asset://x` is the older spelling of the same thing as `/x`, and both are
 * served from the site root. Root-absolute matters: stripping the scheme and
 * leaving `images/x.png` resolves against the CURRENT ROUTE, so a page at
 * `/comp/image` asks for `/comp/images/x.png`, gets the SPA fallback's
 * index.html with a 200, and shows a broken image with nothing in the log.
 * A src that is already relative is left alone — that is the author asking
 * for browser semantics.
 *
 * Shared by the web `<image>` and the web `loadCanvasImage`, so a src that
 * works in one works in the other. Kept out of the component module: the
 * canvas side must not pull Vue components into the app bundle. */
export function resolveImageSrc(src: string): string {
  if (!src.startsWith('asset://')) return src;
  return '/' + src.slice('asset://'.length).replace(/^\/+/, '');
}
