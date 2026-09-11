// Node array (from parse.ts, or straight from the page) → a trusted tree.
//
// The whitelist is the mini program's, verbatim
// (developers.weixin.qq.com/miniprogram/dev/component/rich-text.html):
// content prepared for WeChat must render the same here, including what
// WeChat refuses to render. An untrusted node goes WITH its subtree —
// `<script>` text must not leak out as a paragraph — and each tag name is
// reported once.
import { decodeEntities } from './entities';
import type { RichTextNode } from './types';
import { warnRichTextOnce } from './warn';

export type TrustedNode =
  | { kind: 'element'; name: string; attrs: Record<string, string>; children: TrustedNode[] }
  | { kind: 'text'; text: string };

const PLAIN_TAGS =
  'a abbr address article aside b bdi bdo big blockquote br caption center ' +
  'cite code dd del dir div dl dt em fieldset font footer h1 h2 h3 h4 h5 h6 ' +
  'header hr i ins label legend li mark nav p pre q rt ruby s section small ' +
  'span strong sub sup tbody tfoot thead tr tt u ul';

const CELL_ATTRS = ['colspan', 'height', 'rowspan', 'width'];

/** Tag → the attributes it may keep besides `class` / `style`. */
const TRUSTED: ReadonlyMap<string, readonly string[]> = new Map<string, readonly string[]>([
  ...PLAIN_TAGS.split(' ').map((tag) => [tag, []] as [string, string[]]),
  ['img', ['alt', 'src', 'height', 'width']],
  ['ol', ['start', 'type']],
  ['table', ['width']],
  ['col', ['span', 'width']],
  ['colgroup', ['span', 'width']],
  ['td', CELL_ATTRS],
  ['th', CELL_ATTRS],
  // the docs list tr twice, once plain and once with the cell attributes
  ['tr', CELL_ATTRS],
]);

export function isTrustedTag(name: string): boolean {
  return TRUSTED.has(name);
}

export function sanitizeNodes(nodes: unknown): TrustedNode[] {
  if (!Array.isArray(nodes)) return [];
  const out: TrustedNode[] = [];
  for (const node of nodes) {
    const trusted = sanitizeNode(node);
    if (trusted) out.push(trusted);
  }
  return out;
}

function sanitizeNode(node: unknown): TrustedNode | null {
  if (!node || typeof node !== 'object') {
    warnRichTextOnce('invalid-node', `ignored a node that is not an object (${String(node)})`);
    return null;
  }
  const raw = node as Partial<RichTextNode> & Record<string, unknown>;
  if (raw.type === 'text') {
    if (typeof raw.text !== 'string' && typeof raw.text !== 'number') {
      warnRichTextOnce('invalid-text', 'ignored a text node without a string `text`');
      return null;
    }
    return { kind: 'text', text: decodeEntities(String(raw.text)) };
  }
  if (raw.type !== undefined && raw.type !== 'node') {
    warnRichTextOnce(`invalid-type:${String(raw.type)}`, `ignored a node of unknown type "${String(raw.type)}"`);
    return null;
  }
  if (typeof raw.name !== 'string' || !raw.name) {
    warnRichTextOnce('invalid-name', 'ignored an element node without a `name`');
    return null;
  }
  // the name is case-insensitive (docs, tip 4)
  const name = raw.name.toLowerCase();
  const allowed = TRUSTED.get(name);
  if (!allowed) {
    warnRichTextOnce(`untrusted:${name}`, `<${name}> is not a trusted tag; removed together with its content`);
    return null;
  }
  const attrs: Record<string, string> = {};
  if (raw.attrs && typeof raw.attrs === 'object') {
    for (const [key, value] of Object.entries(raw.attrs as Record<string, unknown>)) {
      if (typeof value !== 'string' && typeof value !== 'number') continue;
      const k = key.toLowerCase();
      // `id` is not supported (docs, tip 3) and everything else outside the
      // tag's list is dropped the same quiet way WeChat drops it
      if (k === 'class' || k === 'style' || allowed.includes(k)) attrs[k] = String(value);
    }
  }
  return { kind: 'element', name, attrs, children: sanitizeNodes(raw.children) };
}
