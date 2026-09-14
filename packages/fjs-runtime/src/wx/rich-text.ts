// `<rich-text>` on the mini program: the same pipeline the other two ends run
// (rich-text/*: parse → sanitize → layout, components/rich-text.ts), turned
// into plain data a wxml template can draw without calling functions.
//
// Skyline only, and not a part of runtime.ts: the build bundles this file on
// its own as fjs/rich-text.js when some page uses <rich-text>, and
// fjs-rich-text.js requires it. Under the webview renderer the native
// rich-text is used instead (wxml.ts resolveTag, spec 050). Keep its imports
// free of stateful runtime modules (hence css-text.ts, not style.ts).
//
// Why not the native rich-text: under skyline it renders a subset — every
// inline element (b / i / mark / code…) on a line of its own, no ol numbers,
// a table squeezed into one line, img width and pre whitespace ignored — and
// its whitelist warnings differ from ours. The hosts' only extra capability,
// "a text inside a text is a run of the same paragraph", skyline has too.
//
// The shape is what fjs-rich-node's template reads (short keys: this crosses
// setData for every paragraph of a long article):
//   view      { k: 'v', c, s, n: children }
//   paragraph { k: 't', c, s, r: runs }         runs = [{ t, c, s }]
//   inline    { k: 'l', c, s, n: [paragraph | image] }   a paragraph holding images
//   image     { k: 'i', c, s, src, mode, a }   a = no size given: natural size on load
//   divider   { k: 'd', c, s }
//
// A paragraph is ONE level of runs. The layout may nest `text` spans (an
// inline element with a class cannot go into richSpans); wxml cannot recurse
// a template, and a component inside a text would break the line, so nested
// spans are flattened here — classes accumulate, styles merge with the same
// rule as richSpans (mergeSpanStyle). Inheritance between a class on an outer
// span and an inner one is approximated by the inner run carrying both
// classes.
//
// An image cannot sit inside a skyline text, so a paragraph with images
// becomes a wrapping row of text segments and images. A long text segment
// beside an image wraps inside its own box instead of flowing around the
// image (docs/miniprogram.md 已知差异).
import { layoutRichText, type RenderChild, type RenderElement } from '../rich-text/layout';
import { parseHtml } from '../rich-text/parse';
import { sanitizeNodes } from '../rich-text/sanitize';
import { isRichSpans, mergeSpanStyle } from '../rich-text/spans';
import type { RichTextNode } from '../rich-text/types';
import { styleToCssText } from './css-text';

type Style = Record<string, unknown>;

export interface WxRun {
  t: string;
  c: string;
  s: string;
}

export type WxRichNode =
  | { k: 'v'; c: string; s: string; n: WxRichNode[] }
  | { k: 't'; c: string; s: string; r: WxRun[] }
  | { k: 'l'; c: string; s: string; n: WxRichNode[] }
  | { k: 'i'; c: string; s: string; src: string; mode: string; a: boolean }
  | { k: 'd'; c: string; s: string };

/** `nodes` as the page passes it (HTML string or node array) → render data.
 * `scope` is the page's scoped-style class (`data-v-…`), added to every
 * inner node that has a class so the page's `<style scoped>` matches it —
 * the mini program applies page styles to rich-text classes. */
export function buildWxRichText(nodes: unknown, space?: string, scope?: string): WxRichNode[] {
  const raw = typeof nodes === 'string' ? parseHtml(nodes) : Array.isArray(nodes) ? (nodes as RichTextNode[]) : [];
  const tree = layoutRichText(sanitizeNodes(raw), { space: space || undefined });
  const cls = (base?: string) => (base ? (scope ? `${base} ${scope}` : base) : '');
  return tree.map((child) => convert(child, cls));
}

type ClassOf = (base?: string) => string;

function convert(child: RenderChild, cls: ClassOf): WxRichNode {
  if (typeof child === 'string') return { k: 't', c: '', s: '', r: [{ t: child, c: '', s: '' }] };
  const c = cls(child.class);
  const s = child.style ? styleToCssText(child.style) : '';
  switch (child.tag) {
    case 'view':
      return { k: 'v', c, s, n: (child.children ?? []).map((n) => convert(n, cls)) };
    case 'image':
      return image(child, c, s);
    case 'divider':
      return { k: 'd', c, s };
    case 'text':
    default:
      return paragraph(child, c, s, cls);
  }
}

function image(el: RenderElement, c: string, s: string): WxRichNode {
  const props = el.props ?? {};
  const auto = el.style?.width === undefined && el.style?.height === undefined;
  return { k: 'i', c, s, src: String(props.src ?? ''), mode: typeof props.mode === 'string' ? props.mode : '', a: auto };
}

function paragraph(el: RenderElement, c: string, s: string, cls: ClassOf): WxRichNode {
  const spans = el.props?.richSpans;
  if (isRichSpans(spans)) {
    return {
      k: 't',
      c,
      s,
      r: spans.map((run) =>
        typeof run === 'string' ? { t: run, c: '', s: '' } : { t: run.t, c: '', s: styleToCssText(run.s) },
      ),
    };
  }
  // runs, with images splitting the paragraph into segments
  const parts: WxRichNode[] = [];
  let runs: WxRun[] = [];
  const flushRuns = () => {
    if (runs.length) parts.push({ k: 't', c: '', s: '', r: runs });
    runs = [];
  };
  const walk = (list: readonly RenderChild[], classes: string[], style: Style | null) => {
    for (const child of list) {
      if (typeof child === 'string') {
        if (child) runs.push({ t: child, c: cls(classes.join(' ')), s: style ? styleToCssText(style) : '' });
        continue;
      }
      if (child.tag === 'image') {
        flushRuns();
        parts.push(image(child, cls(child.class), child.style ? styleToCssText(child.style) : ''));
        continue;
      }
      const nextClasses = child.class ? [...classes, child.class] : classes;
      const nextStyle = child.style ? mergeSpanStyle(style, child.style) : style;
      walk(child.children ?? [], nextClasses, nextStyle);
    }
  };
  walk(el.children ?? [], [], null);
  flushRuns();
  if (parts.length === 1 && parts[0].k === 't') return { k: 't', c, s, r: parts[0].r };
  // a text box beside an image ends at the image: skyline trims a space at
  // either end of it, and "小图 <img> 与文字" lost both gaps
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.k !== 't' || !part.r.length) continue;
    if (i > 0) part.r[0].t = part.r[0].t.replace(/^ /, '\u00a0');
    const last = part.r[part.r.length - 1];
    if (i < parts.length - 1) last.t = last.t.replace(/ $/, '\u00a0');
  }
  if (!parts.some((p) => p.k === 'i')) {
    return { k: 't', c, s, r: parts.flatMap((p) => (p.k === 't' ? p.r : [])) };
  }
  return { k: 'l', c, s, n: parts };
}
