// Default look of each trusted tag: the browser UA stylesheet, which is what
// a mini program's rich-text renders with.
//
// Every `em` is folded into px against a 14px base (the `text` tag's
// default size, widgets/text.dart / base-css.ts) and written down here as a
// number. The style engine has no `em` — it rewrites them at build time —
// and this content arrives at run time, so a heading cannot follow a
// font-size the page puts on <rich-text>. That is a documented difference
// (docs/ui-api.md), and the alternative, re-deriving sizes from a font size
// JS never sees resolved, would only be right when the page sets it inline.
//
// These are plain style objects in the shape a template's `:style` takes
// (camelCase, bare numbers are px), so both substrates take them unchanged:
// the style engine on Flutter, normalizeStyleValues on the web.

export type Style = Record<string, unknown>;

const BASE = 14;
const em = (n: number, base = BASE) => Math.round(n * base * 100) / 100;

/** Tags laid out as block boxes; everything else trusted is inline. */
export const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'caption', 'center', 'dd',
  'dir', 'div', 'dl', 'dt', 'fieldset', 'footer', 'h1', 'h2', 'h3', 'h4',
  'h5', 'h6', 'header', 'hr', 'legend', 'li', 'nav', 'ol', 'p', 'pre',
  'section', 'table', 'tbody', 'tfoot', 'thead', 'tr', 'td', 'th', 'ul',
  // not boxes of their own: col / colgroup only size columns, which the
  // table fallback does not have; they are dropped in layout
  'col', 'colgroup',
]);

const heading = (size: number, margin: number): Style => {
  const fontSize = em(size);
  return {
    fontSize,
    fontWeight: 'bold',
    marginTop: em(margin, fontSize),
    marginBottom: em(margin, fontSize),
  };
};

const vertical = (margin: number): Style => ({ marginTop: margin, marginBottom: margin });

export const TAG_STYLES: Readonly<Record<string, Style>> = {
  // blocks
  p: vertical(BASE),
  pre: { ...vertical(BASE), fontFamily: 'monospace' },
  blockquote: { ...vertical(BASE), marginLeft: 40, marginRight: 40 },
  dl: vertical(BASE),
  dd: { marginLeft: 40 },
  center: { textAlign: 'center' },
  address: { fontStyle: 'italic' },
  caption: { textAlign: 'center' },
  h1: heading(2, 0.67),
  h2: heading(1.5, 0.83),
  h3: heading(1.17, 1),
  h4: heading(1, 1.33),
  h5: heading(0.83, 1.67),
  h6: heading(0.67, 2.33),
  ul: vertical(BASE),
  ol: vertical(BASE),
  dir: vertical(BASE),
  hr: { marginTop: 7, marginBottom: 7 },
  th: { fontWeight: 'bold', textAlign: 'center' },

  // inline
  b: { fontWeight: 'bold' },
  strong: { fontWeight: 'bold' },
  i: { fontStyle: 'italic' },
  em: { fontStyle: 'italic' },
  cite: { fontStyle: 'italic' },
  u: { textDecoration: 'underline' },
  ins: { textDecoration: 'underline' },
  s: { textDecoration: 'line-through' },
  del: { textDecoration: 'line-through' },
  code: { fontFamily: 'monospace' },
  tt: { fontFamily: 'monospace' },
  small: { fontSize: em(0.83) },
  big: { fontSize: em(1.2) },
  sub: { fontSize: em(0.83), verticalAlign: 'sub' },
  sup: { fontSize: em(0.83), verticalAlign: 'super' },
  mark: { backgroundColor: '#FFFF00', color: '#000000' },
  // ruby is only degraded: the annotation follows the base text, small
  rt: { fontSize: em(0.5) },
};

/** A nested list (a list inside an li) has no vertical margin, as in the UA
 * stylesheet's `ul ul, ol ul, … { margin: 0 }`. */
export const NESTED_LIST_STYLE: Style = { marginTop: 0, marginBottom: 0 };

/** Left gutter a list reserves for its markers (UA `padding-left: 40px`). */
export const LIST_GUTTER = 40;

/** Space between a marker and the item's content, taken out of the gutter. */
export const LIST_MARKER_GAP = 6;

/** `ul` markers by nesting depth; the third one repeats below that.
 *
 * The square is U+25A0, not the smaller U+25AA the eye might pick: U+25AA has
 * an emoji presentation, and on iOS Flutter hands it to an emoji font it
 * cannot resolve — the third level of a list drew as a tofu box on the
 * simulator while the browser showed a square (docs/ui-api.md, emoji). */
export const UL_MARKERS = ['•', '◦', '■'];

export const Q_OPEN = '“';
export const Q_CLOSE = '”';
