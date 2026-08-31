// The two fjs style keys a browser would not understand on its own,
// rewritten to the CSS that means the same thing Flutter reads.
//
// Pure string work, no DOM: the esbuild web build calls this through
// `injectStyle`, and the CLI's Vite plugin calls it from Node on every SFC
// <style> block, so a Vite-served page lays out like a `fjs build --web` one.
//
// The boundary these match is "not part of a longer property name" rather
// than the start of a declaration: compileStyle leaves comments in, so a
// declaration does not always follow a `;` or a `{`.

// `flex-grow: n` becomes an Expanded on Flutter: the child gets its share of
// what is left over, not its natural size plus a share. CSS keeps the
// natural size in flex-basis, so a tall scrolling page would push the rest
// of the column (a bottom tabBar, say) off-screen or squash it. Rewriting to
// the `n 1 0` shorthand is the same declaration Flutter reads.
const FLEX_GROW_DECL =
  /(^|[^-\w])flex-grow\s*:\s*([0-9.]+)\s*(!important)?(?=\s*[;}]|\s*$)/g;

// `direction: horizontal` is scroll-view's own style key — it picks the axis
// of the Flutter scrollable. The CSS property of that name means something
// else (ltr / rtl), so a browser drops the declaration as invalid and the
// scroll-view never scrolls sideways. Rewrite it to the overflow pair it
// stands for; a real `direction: ltr | rtl` passes through untouched.
const DIRECTION_DECL =
  /(^|[^-\w])direction\s*:\s*(horizontal|vertical)\s*(!important)?(?=\s*[;}]|\s*$)/g;

function expandFlexGrow(css: string): string {
  return css.replace(
    FLEX_GROW_DECL,
    (_m, before: string, grow: string, bang = '') =>
      `${before}flex: ${grow} 1 0%${bang ? ' ' + bang : ''}`,
  );
}

function expandDirection(css: string): string {
  return css.replace(
    DIRECTION_DECL,
    (_m, before: string, axis: string, bang = '') => {
      const b = bang ? ' ' + bang : '';
      return axis === 'horizontal'
        ? `${before}overflow-x: auto${b}; overflow-y: hidden${b}`
        : `${before}overflow-x: hidden${b}; overflow-y: auto${b}`;
    },
  );
}

/** Rewrites the fjs-only style keys in one CSS source. Idempotent. */
export function rewriteFjsCss(css: string): string {
  return expandDirection(expandFlexGrow(css));
}
