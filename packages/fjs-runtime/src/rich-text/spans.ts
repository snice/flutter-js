// A paragraph's inline content as data, carried by ONE `text` node.
//
// spec 034 built every inline element as a nested `text` and every run of
// words as a text node of its own: a mixed paragraph was 12 nodes, and a
// product page's worth of them put ~500 on an old iPhone at once, where JS
// object count is what the GC pays for (docs/performance.md, 真机复核).
// The shape below lets the hosts lay the same paragraph out from one prop —
// widgets/text.dart builds TextSpans, web/components/basic.ts builds spans.
//
// Internal to rich-text (specs/035 §7 Q3): pages do not write it and the
// shape may change with the component.
//
// Two things cannot be flattened, and a paragraph holding either keeps the
// nested nodes of spec 034:
// - a `class` on an inline element. Its style is the page's CSS, resolved by
//   the style engine against an element and its scope; plain data has no
//   element to match.
// - an image. It needs a node of its own to load, to report @load/@error and
//   to be laid out by `mode` — an inline box, not a run of text.
// Editor-produced body text carries inline `style`, not classes, so the long
// paragraphs this is for take the flat path.
import type { RenderChild } from './layout';

/** A run of text: bare, or with the style the run itself adds (defaults +
 * its `style` attribute, merged down the inline elements it sits in).
 * Nothing inherited from the paragraph is repeated here — inheritance is the
 * host's job (TextSpan style inheritance / CSS inheritance). */
export type RichSpan = string | { t: string; s: Record<string, unknown> };

export function isRichSpans(value: unknown): value is RichSpan[] {
  return (
    Array.isArray(value) &&
    value.every(
      (span) =>
        typeof span === 'string' ||
        (!!span &&
          typeof span === 'object' &&
          typeof (span as { t?: unknown }).t === 'string' &&
          !!(span as { s?: unknown }).s &&
          typeof (span as { s?: unknown }).s === 'object'),
    )
  );
}

type Style = Record<string, unknown>;

/** The style of a run inside `outer`: the inner element's declarations win,
 * except text-decoration, which the browser PROPAGATES — `<u>a<s>b</s></u>`
 * draws b underlined and struck through, and an inner `none` cannot remove a
 * line an ancestor draws. */
export function mergeSpanStyle(outer: Style | null, own: Style): Style {
  if (!outer) return own;
  const merged: Style = { ...outer, ...own };
  const lines = new Set<string>();
  for (const value of [outer.textDecoration, own.textDecoration]) {
    if (typeof value !== 'string') continue;
    for (const word of value.split(/\s+/)) if (word && word !== 'none') lines.add(word);
  }
  if (lines.size) merged.textDecoration = [...lines].join(' ');
  return merged;
}

/** Flattens a paragraph's children (strings and nested `text` spans, as
 * layout.ts builds them) into runs. Null when the paragraph has to keep its
 * nodes (a class or an image, see above). */
export function flattenSpans(children: readonly RenderChild[]): RichSpan[] | null {
  const out: RichSpan[] = [];
  let lastKey: string | null = null;

  const push = (text: string, style: Style | null) => {
    if (!text) return;
    const hasStyle = !!style && Object.keys(style).length > 0;
    const key = hasStyle ? JSON.stringify(style) : '';
    if (lastKey === key && out.length) {
      // two runs that look the same are one run
      const last = out[out.length - 1];
      if (typeof last === 'string') out[out.length - 1] = last + text;
      else last.t += text;
      return;
    }
    out.push(hasStyle ? { t: text, s: style! } : text);
    lastKey = key;
  };

  const walk = (list: readonly RenderChild[], style: Style | null): boolean => {
    for (const child of list) {
      if (typeof child === 'string') {
        push(child, style);
        continue;
      }
      if (child.tag !== 'text' || child.class) return false;
      const next = child.style ? mergeSpanStyle(style, child.style) : style;
      if (!walk(child.children ?? [], next)) return false;
    }
    return true;
  };

  return walk(children, null) ? out : null;
}
