// Trusted tree → render tree: the four fjs tags a rich-text is built from.
//
// This is where HTML's layout model is flattened onto fjs's, and it is pure
// data on purpose — no Vue, no platform — so it is the one place both
// substrates agree on, and the place the tests pin:
//
// - Blocks become `view`s. A run of inline content inside a block becomes
//   ONE `text` (an anonymous paragraph, as CSS makes an anonymous block box),
//   and the inline elements inside it become nested `text` spans. The
//   hosts lay nested text out inline (specs/034 §3.5).
// - Whitespace is resolved to final characters here, not left to the host:
//   Flutter does not collapse spaces at all, the web's `text` rule is
//   `pre-line`. Collapsing in JS gives both the same string.
// - Lists, tables, quotes and the marker/number arithmetic are plain
//   composition of view + text.
// - Sibling margins are collapsed between DEFAULT margins only. Flex
//   containers (both hosts) never collapse, so two paragraphs would sit 2em
//   apart instead of the browser's 1em; margins a page adds through a class
//   are resolved by the style engine, out of sight of this file, so they
//   stay uncollapsed — a documented difference (docs/web.md).
import { parseInlineCss } from '../css/parser';
import {
  BLOCK_TAGS,
  LIST_GUTTER,
  LIST_MARKER_GAP,
  NESTED_LIST_STYLE,
  Q_CLOSE,
  Q_OPEN,
  TAG_STYLES,
  UL_MARKERS,
  type Style,
} from './defaults';
import type { TrustedNode } from './sanitize';
import { flattenSpans } from './spans';
import type { RichTextSpace } from './types';
import { warnRichTextOnce } from './warn';

export interface RenderElement {
  tag: 'view' | 'text' | 'image' | 'divider';
  style?: Style;
  class?: string;
  /** Props other than class / style (image's src and mode). */
  props?: Record<string, unknown>;
  /** Strings are text nodes. Only `view` and `text` have children. */
  children?: RenderChild[];
}

export type RenderChild = RenderElement | string;

export interface LayoutOptions {
  space?: string;
}

type Element = Extract<TrustedNode, { kind: 'element' }>;

interface Context {
  pre: boolean;
  /** How many lists enclose this point (for ul marker choice). */
  listDepth: number;
  /** Inline elements an inline-containing-block split has to reapply. */
  wrappers: Element[];
  spaceChar: string | null;
}

/** Leaves the whitespace pass walks. Kept by reference while building a
 * paragraph so collapsing can look back across span boundaries. */
interface TextLeaf {
  parent: RenderChild[];
  index: number;
  pre: boolean;
}

interface Meta {
  /** Default (not page-written) vertical margins, for sibling collapsing. */
  defaultTop?: number;
  defaultBottom?: number;
  /** An anonymous paragraph (buildParagraph), which the block around it may
   * absorb — see mergeParagraph. */
  anonymous?: boolean;
}

const meta = new WeakMap<RenderElement, Meta>();

const SPACE_CHARS: Record<RichTextSpace, string> = {
  nbsp: '\u00a0',
  ensp: '\u2002',
  emsp: '\u2003',
};

const NBSP = '\u00a0';

export function layoutRichText(nodes: TrustedNode[], options: LayoutOptions = {}): RenderChild[] {
  let spaceChar: string | null = null;
  if (options.space !== undefined && options.space !== null && options.space !== '') {
    const known = SPACE_CHARS[options.space as RichTextSpace];
    if (known) spaceChar = known;
    else {
      warnRichTextOnce(
        `space:${options.space}`,
        `space="${options.space}" is not one of ensp / emsp / nbsp; spaces collapse as if it were unset`,
      );
    }
  }
  return layoutBlockChildren(nodes, { pre: false, listDepth: 0, wrappers: [], spaceChar });
}

// ---- blocks -------------------------------------------------------------------

function isBlock(node: TrustedNode): boolean {
  return node.kind === 'element' && BLOCK_TAGS.has(node.name);
}

function containsBlock(node: TrustedNode): node is Element {
  if (node.kind !== 'element') return false;
  return node.children.some((child) => isBlock(child) || containsBlock(child));
}

/** Lays out the children of a block box: blocks as they are, runs of
 * inline content folded into anonymous paragraphs. */
function layoutBlockChildren(nodes: TrustedNode[], ctx: Context): RenderChild[] {
  const out: RenderElement[] = [];
  let run: Array<{ node: TrustedNode; wrappers: Element[] }> = [];

  const flush = () => {
    if (run.length) {
      const paragraph = buildParagraph(run, ctx);
      if (paragraph) out.push(paragraph);
    }
    run = [];
  };

  const visit = (list: TrustedNode[], wrappers: Element[]) => {
    for (const node of list) {
      if (node.kind === 'element' && isBlock(node)) {
        flush();
        const block = layoutBlock(node, { ...ctx, wrappers });
        if (block) out.push(block);
      } else if (containsBlock(node)) {
        // `<b>x<p>y</p>z</b>`: the browser splits the inline box around the
        // block. Walk its children at this level, remembering the <b> so
        // every piece of inline content in there is still wrapped in it.
        visit(node.children, [...wrappers, node]);
      } else {
        run.push({ node, wrappers });
      }
    }
  };
  visit(nodes, ctx.wrappers);
  flush();

  collapseSiblingMargins(out);
  return out;
}

function layoutBlock(node: Element, ctx: Context): RenderElement | null {
  switch (node.name) {
    case 'col':
    case 'colgroup':
      // column sizing only; the table fallback has no columns
      return null;
    case 'hr':
      return element('divider', node);
    case 'ul':
    case 'ol':
    case 'dir':
      return layoutList(node, ctx);
    case 'li':
      // an li outside any list still gets a bullet, as display: list-item does
      return layoutListItem(node, UL_MARKERS[0], ctx);
    case 'table':
      return layoutTable(node, ctx);
    case 'thead':
    case 'tbody':
    case 'tfoot':
      return layoutRowGroup(node, ctx);
    case 'tr':
      return layoutRow(node, ctx);
    case 'td':
    case 'th':
      return layoutCell(node, ctx);
    default: {
      const box = element('view', node);
      const inner: Context = { ...ctx, pre: ctx.pre || node.name === 'pre' };
      let children = node.children;
      const first = children[0];
      if (node.name === 'pre' && first?.kind === 'text' && /^\r?\n/.test(first.text)) {
        // HTML drops the newline right after <pre>, so `<pre>\ncode</pre>`
        // does not start with an empty line
        children = [{ kind: 'text', text: first.text.replace(/^\r?\n/, '') }, ...children.slice(1)];
      }
      const laid = layoutBlockChildren(children, inner);
      const merged = mergeParagraph(box, laid);
      if (merged) return merged;
      // An unstyled wrapper around a single block (`<div><p>…</p></div>`,
      // common in editor output) adds a node and nothing you can see.
      if (!box.style && !box.class && laid.length === 1 && typeof laid[0] !== 'string') {
        return laid[0];
      }
      box.children = laid;
      return box;
    }
  }
}

/** Style keys that make a block arrange its children as a flex container. A
 * block that writes one keeps its own view: a text box would not honour it. */
const BOX_LAYOUT_KEYS = [
  'display', 'flexDirection', 'flexWrap', 'justifyContent', 'alignItems',
  'alignContent', 'gap', 'rowGap', 'columnGap',
];

/** A block whose content laid out as exactly one anonymous paragraph IS that
 * paragraph: `<p>` / `<h3>` / `<td>` with only words in it becomes one `text`
 * carrying the block's style, class and default margins, instead of a view
 * with a text inside (specs/035 §3.1). A `text` is a box — margin, padding,
 * background and radius are drawn the same way a view's are, and it
 * stretches across a column the same way — so nothing moves.
 *
 * Not merged: a paragraph that is itself a merged block (two blocks' margins
 * on one box would change what collapses), and a block with a flex layout
 * key in its style. List rows and table rows never reach here. */
function mergeParagraph(box: RenderElement, laid: RenderChild[]): RenderElement | null {
  if (laid.length !== 1) return null;
  const only = laid[0];
  if (typeof only === 'string' || !meta.get(only)?.anonymous) return null;
  if (box.style && BOX_LAYOUT_KEYS.some((key) => key in box.style!)) return null;
  const merged: RenderElement = { ...only };
  if (box.style) merged.style = box.style;
  if (box.class) merged.class = box.class;
  const boxMeta = meta.get(box);
  meta.set(merged, { defaultTop: boxMeta?.defaultTop, defaultBottom: boxMeta?.defaultBottom });
  return merged;
}

/** A view / text / divider for a trusted element: its default style with the
 * page's `style` attribute on top, and its `class`. */
function element(tag: RenderElement['tag'], node: Element, extra?: Style): RenderElement {
  const defaults = TAG_STYLES[node.name];
  const own = node.attrs.style ? parseInlineCss(node.attrs.style) : undefined;
  const style: Style = { ...defaults, ...extra, ...own };
  const out: RenderElement = { tag };
  if (Object.keys(style).length) out.style = style;
  if (node.attrs.class) out.class = node.attrs.class;
  const m: Meta = {};
  if (defaults?.marginTop !== undefined && !hasMarginOverride(own, 'Top')) {
    m.defaultTop = defaults.marginTop as number;
  }
  if (defaults?.marginBottom !== undefined && !hasMarginOverride(own, 'Bottom')) {
    m.defaultBottom = defaults.marginBottom as number;
  }
  meta.set(out, m);
  return out;
}

function hasMarginOverride(own: Style | undefined, side: 'Top' | 'Bottom'): boolean {
  return !!own && (`margin${side}` in own || 'margin' in own);
}

function collapseSiblingMargins(blocks: RenderElement[]): void {
  for (let i = 1; i < blocks.length; i++) {
    const prev = meta.get(blocks[i - 1]);
    const next = meta.get(blocks[i]);
    if (prev?.defaultBottom === undefined || next?.defaultTop === undefined) continue;
    // CSS keeps the larger of the two; put all of it on the lower box
    const collapsed = Math.max(prev.defaultBottom, next.defaultTop);
    blocks[i - 1].style!.marginBottom = 0;
    blocks[i].style!.marginTop = collapsed;
  }
}

// ---- lists --------------------------------------------------------------------

function layoutList(node: Element, ctx: Context): RenderElement {
  const nested = ctx.listDepth > 0;
  const list = element('view', node, nested ? NESTED_LIST_STYLE : undefined);
  if (nested) meta.set(list, {});
  const inner: Context = { ...ctx, listDepth: ctx.listDepth + 1 };
  const ordered = node.name === 'ol';
  const start = ordered ? parseInt(node.attrs.start ?? '', 10) : NaN;
  const type = ordered ? (node.attrs.type ?? '1') : '';
  let counter = Number.isFinite(start) ? start : 1;
  const bullet = UL_MARKERS[Math.min(ctx.listDepth, UL_MARKERS.length - 1)];

  const children: RenderChild[] = [];
  const stray: TrustedNode[] = [];
  const flushStray = () => {
    if (stray.length) children.push(...layoutBlockChildren(stray.splice(0), inner));
  };
  for (const child of node.children) {
    if (child.kind === 'element' && child.name === 'li') {
      flushStray();
      const marker = ordered ? `${formatOrdinal(counter++, type)}.` : bullet;
      children.push(layoutListItem(child, marker, inner));
    } else {
      stray.push(child);
    }
  }
  flushStray();
  list.children = children;
  return list;
}

function layoutListItem(node: Element, marker: string, ctx: Context): RenderElement {
  // Row: a marker cell sitting in the list's gutter, then the content. The
  // UA puts the marker OUTSIDE the content box in padding the list reserves;
  // a fixed-width cell in the row is the same picture built from flex.
  const row = element('view', node, { flexDirection: 'row', alignItems: 'flex-start' });
  const markerText: RenderElement = {
    tag: 'text',
    style: {
      width: LIST_GUTTER,
      paddingRight: LIST_MARKER_GAP,
      textAlign: 'right',
      flexShrink: 0,
    },
    children: [marker],
  };
  const laid = layoutBlockChildren(node.children, { ...ctx, wrappers: [] });
  const grow: Style = { flexGrow: 1, flexShrink: 1, minWidth: 0 };
  // an item that is only words is the row's second cell itself, not a view
  // wrapping a paragraph
  const onlyText = laid.length === 1 && typeof laid[0] !== 'string' && laid[0].tag === 'text' ? laid[0] : null;
  const content: RenderElement = onlyText
    ? { ...onlyText, style: { ...onlyText.style, ...grow } }
    : { tag: 'view', style: grow, children: laid };
  row.children = [markerText, content];
  return row;
}

export function formatOrdinal(n: number, type: string): string {
  switch (type) {
    case 'a':
      return alpha(n).toLowerCase();
    case 'A':
      return alpha(n);
    case 'i':
      return roman(n).toLowerCase();
    case 'I':
      return roman(n);
    default:
      return String(n);
  }
}

function alpha(n: number): string {
  // browsers fall back to decimal outside the counter style's range
  if (n < 1) return String(n);
  let s = '';
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

function roman(n: number): string {
  if (n < 1 || n > 3999) return String(n);
  const table: Array<[number, string]> = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let s = '';
  for (const [value, digits] of table) {
    while (n >= value) {
      s += digits;
      n -= value;
    }
  }
  return s;
}

// ---- tables -------------------------------------------------------------------
//
// A flex grid, not a table: rows are horizontal views, cells share the row
// (or take their `width`). There is no column model, so colspan / rowspan
// cannot be honoured — they are reported and ignored.

function layoutTable(node: Element, ctx: Context): RenderElement {
  const table = element('view', node, sizeFromAttrs(node, false));
  const captions: RenderChild[] = [];
  const rows: TrustedNode[] = [];
  for (const child of node.children) {
    if (child.kind === 'element' && child.name === 'caption') {
      captions.push(layoutBlock(child, ctx)!);
    } else {
      rows.push(child);
    }
  }
  table.children = [...captions, ...layoutRowGroup({ ...node, children: rows }, ctx).children!];
  return table;
}

/** thead / tbody / tfoot produce no box: their rows belong to the table. A
 * run of cells with no <tr> around them becomes an anonymous row. */
function layoutRowGroup(node: Element, ctx: Context): RenderElement {
  const out: RenderChild[] = [];
  let cells: Element[] = [];
  const flushCells = () => {
    if (cells.length) {
      out.push(rowOf(cells.splice(0), ctx, { tag: 'view', style: { flexDirection: 'row', alignItems: 'stretch' } }));
    }
  };
  const rest: TrustedNode[] = [];
  const flushRest = () => {
    if (rest.length) out.push(...layoutBlockChildren(rest.splice(0), ctx));
  };
  const walk = (list: TrustedNode[]) => {
    for (const child of list) {
      if (child.kind !== 'element') {
        // whitespace between rows is formatting, not content
        if (child.text.trim()) {
          flushCells();
          rest.push(child);
        }
        continue;
      }
      if (child.name === 'thead' || child.name === 'tbody' || child.name === 'tfoot') {
        flushCells();
        flushRest();
        walk(child.children);
      } else if (child.name === 'tr') {
        flushCells();
        flushRest();
        out.push(layoutRow(child, ctx));
      } else if (child.name === 'td' || child.name === 'th') {
        flushRest();
        cells.push(child);
      } else if (child.name === 'col' || child.name === 'colgroup') {
        continue;
      } else {
        flushCells();
        rest.push(child);
      }
    }
  };
  walk(node.children);
  flushCells();
  flushRest();
  const group: RenderElement = { tag: 'view', children: out };
  return group;
}

function layoutRow(node: Element, ctx: Context): RenderElement {
  const cells = node.children.filter(
    (child): child is Element => child.kind === 'element' && (child.name === 'td' || child.name === 'th'),
  );
  return rowOf(cells, ctx, element('view', node, { flexDirection: 'row', alignItems: 'stretch' }));
}

function rowOf(cells: Element[], ctx: Context, row: RenderElement): RenderElement {
  row.children = cells.map((cell) => layoutCell(cell, ctx));
  return row;
}

function layoutCell(node: Element, ctx: Context): RenderElement {
  for (const span of ['colspan', 'rowspan']) {
    if (node.attrs[span] !== undefined && node.attrs[span] !== '1') {
      warnRichTextOnce(`table:${span}`, `<${node.name} ${span}> is not supported (tables are a flex grid); ignored`);
    }
  }
  const size = sizeFromAttrs(node, true);
  const flex: Style = size.width !== undefined ? { flexShrink: 0 } : { flexGrow: 1, flexShrink: 1, minWidth: 0 };
  // flexShrink / minWidth are written even where a view would not need them:
  // a merged cell is a `text`, and the web's base `text` rule does not shrink
  // (base-css.ts), which would push a long cell out of its row
  const cell = element('view', node, { padding: 1, ...flex, ...size });
  const laid = layoutBlockChildren(node.children, ctx);
  const merged = mergeParagraph(cell, laid);
  if (merged) return merged;
  cell.children = laid;
  return cell;
}

// ---- sizes --------------------------------------------------------------------

/** HTML width / height attributes: a bare number or `Npx` is pixels, `N%` is
 * a percentage (sizes are the one place the style engine takes one). */
function sizeFromAttrs(node: Element, allowPercent: boolean): Style {
  const out: Style = {};
  for (const key of ['width', 'height'] as const) {
    const raw = node.attrs[key];
    if (raw === undefined) continue;
    const length = parseLength(raw);
    if (length === null) continue;
    if (typeof length === 'string' && !allowPercent) {
      warnRichTextOnce(`percent:${node.name}:${key}`, `<${node.name} ${key}="${raw}"> as a percentage is not supported; ignored`);
      continue;
    }
    out[key] = length;
  }
  return out;
}

function parseLength(raw: string): number | string | null {
  const v = raw.trim();
  const px = /^(\d+(?:\.\d+)?)(?:px)?$/.exec(v);
  if (px) return parseFloat(px[1]);
  if (/^\d+(?:\.\d+)?%$/.test(v)) return v;
  return null;
}

// ---- paragraphs ---------------------------------------------------------------

function buildParagraph(
  run: Array<{ node: TrustedNode; wrappers: Element[] }>,
  ctx: Context,
): RenderElement | null {
  const children: RenderChild[] = [];
  const leaves: TextLeaf[] = [];
  let hasBox = false;

  const inline = (node: TrustedNode, parent: RenderChild[]) => {
    if (node.kind === 'text') {
      let text = ctx.pre ? preText(node.text) : node.text;
      if (!ctx.pre && ctx.spaceChar) text = text.replace(/ /g, ctx.spaceChar);
      parent.push(text);
      leaves.push({ parent, index: parent.length - 1, pre: ctx.pre });
      return;
    }
    switch (node.name) {
      case 'br':
        parent.push('\n');
        leaves.push({ parent, index: parent.length - 1, pre: true });
        return;
      case 'img': {
        const image = layoutImage(node);
        if (image) {
          parent.push(image);
          hasBox = true;
          // an inline box is content: a space after it is not leading
          leaves.push({ parent, index: parent.length - 1, pre: true });
        }
        return;
      }
      default: {
        const plain = !TAG_STYLES[node.name] && !node.attrs.style && !node.attrs.class;
        let target = parent;
        if (!plain) {
          const span = element('text', node);
          span.children = [];
          parent.push(span);
          target = span.children;
        }
        if (node.name === 'q') {
          target.push(Q_OPEN);
          leaves.push({ parent: target, index: target.length - 1, pre: true });
        }
        for (const child of node.children) inline(child, target);
        if (node.name === 'q') {
          target.push(Q_CLOSE);
          leaves.push({ parent: target, index: target.length - 1, pre: true });
        }
      }
    }
  };

  for (const { node, wrappers } of run) {
    // re-open the inline elements a block split this run out of
    let parent = children;
    for (const wrapper of wrappers) {
      const span = element('text', wrapper);
      span.children = [];
      parent.push(span);
      parent = span.children;
    }
    inline(node, parent);
  }

  collapseWhitespace(leaves, ctx.pre);
  const pruned = prune(children);
  if (!pruned.length) return null;
  if (!hasBox && !hasVisibleText(pruned)) return null;

  // One node for the whole paragraph where it can be (specs/035 §3.2): the
  // runs as data on the text, or its lone string as element text. A class
  // or an image inside keeps the nested nodes (rich-text/spans.ts).
  const paragraph: RenderElement = { tag: 'text' };
  const spans = flattenSpans(pruned);
  if (!spans) paragraph.children = pruned;
  else if (spans.length === 1 && typeof spans[0] === 'string') paragraph.children = [spans[0]];
  else paragraph.props = { richSpans: spans };
  meta.set(paragraph, { anonymous: true });
  return paragraph;
}

function preText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, NBSP.repeat(4))
    .replace(/ /g, NBSP);
}

/** HTML's white-space: normal, across span boundaries: runs of whitespace
 * become one space, a space right after another (or at the start of the
 * paragraph, or right after a line break) goes, and so does a space right
 * before a line break or at the end. */
function collapseWhitespace(leaves: TextLeaf[], inPre: boolean): void {
  let pendingSpace: TextLeaf | null = null; // last leaf that ends in a collapsible space
  let atLineStart = true;

  const trimTrailing = (leaf: TextLeaf | null) => {
    if (!leaf) return;
    const text = leaf.parent[leaf.index] as string;
    leaf.parent[leaf.index] = text.replace(/ $/, '');
  };

  for (const leaf of leaves) {
    const value = leaf.parent[leaf.index];
    if (typeof value !== 'string') {
      // inline box (img)
      pendingSpace = null;
      atLineStart = false;
      continue;
    }
    if (leaf.pre) {
      if (value === '\n') trimTrailing(pendingSpace);
      pendingSpace = null;
      atLineStart = value.endsWith('\n');
      continue;
    }
    let text = value.replace(/[ \t\n\r\f]+/g, ' ');
    if (text.startsWith(' ') && (atLineStart || pendingSpace)) text = text.slice(1);
    leaf.parent[leaf.index] = text;
    if (text.length) {
      atLineStart = false;
      pendingSpace = text.endsWith(' ') ? leaf : null;
    }
  }
  trimTrailing(pendingSpace);

  // one trailing line break ends the last line rather than opening a new,
  // empty one — the browser draws `a<br>` and `<pre>a\n</pre>` as one line,
  // Flutter's Text would draw two
  for (let i = leaves.length - 1; i >= 0; i--) {
    const leaf = leaves[i];
    const value = leaf.parent[leaf.index];
    if (typeof value !== 'string') break;
    if (value === '') continue;
    if (value.endsWith('\n') && (leaf.pre || inPre)) {
      leaf.parent[leaf.index] = value.slice(0, -1);
    }
    break;
  }
}

/** Drops empty strings and spans left with nothing in them. */
function prune(children: RenderChild[]): RenderChild[] {
  const out: RenderChild[] = [];
  for (const child of children) {
    if (typeof child === 'string') {
      if (child) out.push(child);
      continue;
    }
    if (child.tag === 'text') {
      child.children = prune(child.children ?? []);
      if (!child.children.length) continue;
    }
    out.push(child);
  }
  return out;
}

function hasVisibleText(children: RenderChild[]): boolean {
  return children.some((child) =>
    typeof child === 'string'
      ? child.trim().length > 0 || child.includes('\n') || /[\u00a0\u2002\u2003]/.test(child)
      : child.tag !== 'text' || hasVisibleText(child.children ?? []),
  );
}

// ---- images -------------------------------------------------------------------

function layoutImage(node: Element): RenderElement | null {
  const src = node.attrs.src?.trim();
  if (!src) return null;
  const size = sizeFromAttrs(node, false);
  const hasWidth = size.width !== undefined;
  const hasHeight = size.height !== undefined;
  // One side given: keep the picture's ratio, the way <img width="300">
  // does. widthFix / heightFix are the image tag's modes for exactly that,
  // and they need the given side to be absolute, which percentages were
  // filtered out above for (docs/css-compat.md, 单位).
  const mode = hasWidth && !hasHeight ? 'widthFix' : hasHeight && !hasWidth ? 'heightFix' : undefined;
  const image = element('image', node, hasWidth || hasHeight ? size : { maxWidth: '100%' });
  image.props = { src, ...(mode ? { mode } : {}) };
  return image;
}
