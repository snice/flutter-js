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

// The JS style engine reads a bare number as logical pixels on every length
// property (css-compat "数字不带单位 = 逻辑像素"), so `padding: 10 12` is
// normal page syntax. To a BROWSER that declaration is invalid and is
// dropped whole — the box loses its padding on web while the App lays out
// fine, a divergence that only shows up side by side (spec 041 对拍).
// Suffix px onto unitless numbers, per property, matching what the engine
// would compute. `line-height` is deliberately absent: a bare number is a
// multiplier on BOTH ends (the engine keeps its string for exactly that
// reason), and suffixing it would break every page. `z-index` /
// `font-weight` / `opacity` are unitless in real CSS too — not lengths.
const LENGTH_PROPS = new Set([
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'top', 'right', 'bottom', 'left',
  'gap', 'row-gap', 'column-gap',
  'border-radius',
  'border-width', 'border-top-width', 'border-right-width',
  'border-bottom-width', 'border-left-width',
  'font-size', 'letter-spacing',
]);

// One declaration's value: everything up to `;` or `}` (or end). Values with
// !important survive — the suffix pass runs before the bang is re-attached.
const LENGTH_DECL =
  /(^|[^-\w])([a-z-]+)\s*:\s*([^;}]*)/g;

function expandUnitlessLengths(css: string): string {
  return css.replace(LENGTH_DECL, (m, before: string, prop: string, value: string) => {
    if (!LENGTH_PROPS.has(prop)) return m;
    const rewritten = value.replace(/[^\s,]+/g, (token) => {
      // calc(...) / var(...) / percentages / already-unit lengths stay as-is
      if (!/^-?\d+(\.\d+)?$/.test(token)) return token;
      if (token === '0') return token; // unitless zero is valid CSS
      return `${token}px`;
    });
    return `${before}${prop}: ${rewritten}`;
  });
}

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

/** @media conditions get their own unitless pass, BEFORE the main ones
 * mask conditions away: `(min-width: 600)` is an invalid condition to a
 * browser (lengths need units) and the block would be dropped whole, while
 * the App engine reads the unitless value fine — the same two-end
 * divergence the declaration pass exists for. */
function expandUnitlessMediaConditions(css: string): string {
  return css.replace(/@media([^{}]*)\{/g, (m, cond: string) =>
    m.replace(
      cond,
      cond.replace(
        /((?:min-|max-)?(?:width|height))\s*:\s*(\d+(?:\.\d+)?)(?=[\s,)])/g,
        (_mm, prop: string, num: string) => `${prop}: ${num}px`,
      ),
    ),
  );
}

/** Masks the conditions out of the way of the main passes. They must not
 * see `@media (min-width: 600px)`: LENGTH_DECL's `([^;}]*)` value capture
 * has no idea where the condition's `(` closes, so it swallows text up to
 * the next `}` — and its token loop then suffixes px onto an inner rule's
 * `flex-grow: 1` before expandFlexGrow can match, leaving `flex-grow: 1px`
 * (unknown property to a browser, declaration dropped, layout diverges).
 * Conditions carry no fjs-only keys, so masking them out is safe. */
function maskMediaConditions(css: string): { text: string; restore: (s: string) => string } {
  const conditions: string[] = [];
  const text = css.replace(/@media[^{}]*\{/g, (m) => {
    conditions.push(m);
    return `\u0000${conditions.length - 1}\u0000{`;
  });
  return {
    text,
    restore: (s) => s.replace(/\u0000(\d+)\u0000\{/g, (_, i) => conditions[Number(i)] ?? ''),
  };
}

/** Rewrites the fjs-only style keys in one CSS source. Idempotent. */
export function rewriteFjsCss(css: string): string {
  const { text, restore } = maskMediaConditions(expandUnitlessMediaConditions(css));
  return restore(expandDirection(expandFlexGrow(expandUnitlessLengths(text))));
}
