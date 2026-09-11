// HTML string → the mini program's node array.
//
// Why a parser of our own instead of the browser's DOMParser on the web:
// the Flutter side has no DOM, so it needs this file anyway, and a second
// parser on the web would be a second set of error-recovery rules. Editor
// HTML is routinely broken (an unclosed <p>, a <div> inside a <p>), and
// the two sides must build the SAME tree out of it or the paragraph counts
// differ. So both platforms run this one, and the browser's parser is
// never consulted.
//
// The recovery is a pragmatic subset of the HTML5 tree builder: void
// elements, raw-text elements, implied end tags for p / li / dt / dd / tr /
// td / th, stray end tags ignored, anything left open closed at EOF. What
// it does NOT do is the adoption agency (`<b><p>x</b>y</p>`): mis-nested
// formatting is closed at the first end tag that matches, which renders
// the same text with slightly different styling on at most the tail.
//
// Attribute values are entity-decoded here, as HTML does; text is left
// raw and decoded by sanitize.ts, which also sees node arrays that never
// went through this file.
import { decodeEntities } from './entities';
import type { RichTextElementNode, RichTextNode } from './types';

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);

/** Content is text up to the matching end tag, never markup. */
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'xmp']);

/** Start tags that close an open <p> (HTML's "close a p element"). */
const CLOSES_P = new Set([
  'address', 'article', 'aside', 'blockquote', 'center', 'dir', 'div', 'dl',
  'fieldset', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr',
  'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul',
]);

/** For a start tag: which open element it implicitly ends, and which open
 * elements stop the search (the "scope" boundary). */
const IMPLIED_END: Record<string, { ends: string[]; stop: string[] }> = {
  li: { ends: ['li'], stop: ['ul', 'ol', 'table'] },
  dt: { ends: ['dt', 'dd'], stop: ['dl', 'table'] },
  dd: { ends: ['dt', 'dd'], stop: ['dl', 'table'] },
  // the search pops everything above the match, so an open td is closed on
  // the way to its tr — listing td here would stop at the cell and nest the
  // new row inside the old one
  tr: { ends: ['tr'], stop: ['table', 'thead', 'tbody', 'tfoot'] },
  td: { ends: ['td', 'th'], stop: ['tr', 'table'] },
  th: { ends: ['td', 'th'], stop: ['tr', 'table'] },
  thead: { ends: ['thead', 'tbody', 'tfoot'], stop: ['table'] },
  tbody: { ends: ['thead', 'tbody', 'tfoot'], stop: ['table'] },
  tfoot: { ends: ['thead', 'tbody', 'tfoot'], stop: ['table'] },
};

const P_SCOPE_STOP = new Set(['table', 'td', 'th', 'caption', 'li', 'dd', 'dt', 'blockquote']);

const TAG_NAME = /^[a-zA-Z][a-zA-Z0-9-]*/;
const ATTR = /^\s*([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/;

export function parseHtml(html: string): RichTextNode[] {
  const root: RichTextNode[] = [];
  const stack: RichTextElementNode[] = [];
  const children = (): RichTextNode[] =>
    stack.length ? stack[stack.length - 1].children! : root;

  const appendText = (text: string) => {
    if (!text) return;
    const list = children();
    const last = list[list.length - 1];
    if (last && last.type === 'text') last.text += text;
    else list.push({ type: 'text', text });
  };

  /** Pops back to (and including) the nearest open `names` element, unless
   * a `stop` element is found first. */
  const closeNearest = (names: readonly string[], stop: ReadonlySet<string> | readonly string[]) => {
    const stops = stop instanceof Set ? stop : new Set(stop as string[]);
    for (let i = stack.length - 1; i >= 0; i--) {
      const name = stack[i].name;
      if (names.includes(name)) {
        stack.length = i;
        return true;
      }
      if (stops.has(name)) return false;
    }
    return false;
  };

  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt < 0) {
      appendText(html.slice(i));
      break;
    }
    if (lt > i) appendText(html.slice(i, lt));
    i = lt;

    // comment
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    // doctype, CDATA, processing instruction
    if (html[i + 1] === '!' || html[i + 1] === '?') {
      const end = html.indexOf('>', i);
      i = end < 0 ? n : end + 1;
      continue;
    }

    // end tag
    if (html[i + 1] === '/') {
      const m = TAG_NAME.exec(html.slice(i + 2));
      const end = html.indexOf('>', i);
      if (!m) {
        // `</ >` and friends: HTML drops them
        i = end < 0 ? n : end + 1;
        continue;
      }
      const name = m[0].toLowerCase();
      i = end < 0 ? n : end + 1;
      if (name === 'br') {
        // `</br>` is parsed as `<br>` by every browser
        children().push({ name: 'br', children: [] });
      } else {
        closeNearest([name], []);
      }
      continue;
    }

    // start tag
    const m = TAG_NAME.exec(html.slice(i + 1));
    if (!m) {
      appendText('<');
      i += 1;
      continue;
    }
    const name = m[0].toLowerCase();
    let p = i + 1 + m[0].length;
    const attrs: Record<string, string> = {};
    let selfClosing = false;
    while (p < n) {
      const rest = html.slice(p);
      const close = /^\s*(\/?)>/.exec(rest);
      if (close) {
        selfClosing = close[1] === '/';
        p += close[0].length;
        break;
      }
      const a = ATTR.exec(rest);
      if (!a || a[0].length === 0) {
        // a stray character (`<div / class="x">`): skip it
        p += 1;
        continue;
      }
      const key = a[1].toLowerCase();
      if (!(key in attrs)) {
        attrs[key] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '');
      }
      p += a[0].length;
    }
    i = p;

    if (CLOSES_P.has(name)) closeNearest(['p'], P_SCOPE_STOP);
    const implied = IMPLIED_END[name];
    if (implied) closeNearest(implied.ends, implied.stop);

    const node: RichTextElementNode = { name, children: [] };
    if (Object.keys(attrs).length) node.attrs = attrs;
    children().push(node);

    if (VOID.has(name) || selfClosing) continue;

    if (RAW_TEXT.has(name)) {
      const endRe = new RegExp(`</${name}\\s*>`, 'i');
      const rest = html.slice(i);
      const found = endRe.exec(rest);
      const body = found ? rest.slice(0, found.index) : rest;
      if (body) node.children!.push({ type: 'text', text: body });
      i += found ? found.index + found[0].length : rest.length;
      continue;
    }

    stack.push(node);
  }
  return root;
}
