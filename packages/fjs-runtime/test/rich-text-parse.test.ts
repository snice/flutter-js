// specs/034-rich-text: the HTML parser, entity decoding and the whitelist.
// These run identically on both platforms — the web does not use DOMParser
// (rich-text/parse.ts) — so what they pin is what both sides render.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeEntities } from '../src/rich-text/entities';
import { parseHtml } from '../src/rich-text/parse';
import { sanitizeNodes } from '../src/rich-text/sanitize';
import { resetRichTextWarnOnce } from '../src/rich-text/warn';

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetRichTextWarnOnce();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const text = (t: string) => ({ type: 'text', text: t });

describe('decodeEntities', () => {
  it('decodes named, decimal and hex references', () => {
    expect(decodeEntities('&nbsp;&lt;&gt;&amp;&quot;&#39;&#x4e2d;&#25991;')).toBe('\u00a0<>&"\'中文');
  });

  it('keeps an unknown entity as written', () => {
    expect(decodeEntities('a &bogus; b &amp c')).toBe('a &bogus; b &amp c');
  });

  it('maps NUL, surrogates and out-of-range references to U+FFFD', () => {
    expect(decodeEntities('&#0;&#xD800;&#x110000;')).toBe('\ufffd\ufffd\ufffd');
  });

  it('knows the spacing entities space="…" is about', () => {
    expect(decodeEntities('&ensp;&emsp;&thinsp;')).toBe('\u2002\u2003\u2009');
  });
});

describe('parseHtml', () => {
  it('lowercases tag and attribute names', () => {
    expect(parseHtml('<DIV Class="a">x</DIV>')).toEqual([
      { name: 'div', attrs: { class: 'a' }, children: [text('x')] },
    ]);
  });

  it('reads quoted, unquoted and valueless attributes, first one wins, entities decoded', () => {
    const [node] = parseHtml(`<img src='a.png' width=20 alt="x &amp; y" hidden alt="second">`);
    expect(node).toEqual({
      name: 'img',
      attrs: { src: 'a.png', width: '20', alt: 'x & y', hidden: '' },
      children: [],
    });
  });

  it('treats void and self-closing elements as childless', () => {
    expect(parseHtml('<p>a<br>b<img src="x"/>c</p>')).toEqual([
      {
        name: 'p',
        children: [
          text('a'),
          { name: 'br', children: [] },
          text('b'),
          { name: 'img', attrs: { src: 'x' }, children: [] },
          text('c'),
        ],
      },
    ]);
  });

  it('closes an open p when a block starts, and ignores the stray </p>', () => {
    expect(parseHtml('<p>one<p>two')).toEqual([
      { name: 'p', children: [text('one')] },
      { name: 'p', children: [text('two')] },
    ]);
    expect(parseHtml('<p>a<div>b</div>c</p>')).toEqual([
      { name: 'p', children: [text('a')] },
      { name: 'div', children: [text('b')] },
      text('c'),
    ]);
  });

  it('implies the end of li, td and tr', () => {
    expect(parseHtml('<ul><li>a<li>b</ul>')).toEqual([
      { name: 'ul', children: [{ name: 'li', children: [text('a')] }, { name: 'li', children: [text('b')] }] },
    ]);
    const [table] = parseHtml('<table><tr><td>1<td>2<tr><td>3</table>') as Array<{ children: unknown[] }>;
    expect(table.children).toEqual([
      { name: 'tr', children: [{ name: 'td', children: [text('1')] }, { name: 'td', children: [text('2')] }] },
      { name: 'tr', children: [{ name: 'td', children: [text('3')] }] },
    ]);
  });

  it('does not close li across a nested list', () => {
    const [ul] = parseHtml('<ul><li>a<ul><li>b</ul></ul>') as Array<{ children: Array<{ children: unknown[] }> }>;
    expect(ul.children).toHaveLength(1);
    expect(ul.children[0].children[1]).toEqual({
      name: 'ul',
      children: [{ name: 'li', children: [text('b')] }],
    });
  });

  it('skips comments, doctype and processing instructions', () => {
    expect(parseHtml('<!DOCTYPE html><!-- c --><?xml x?>a<!-- unterminated')).toEqual([text('a')]);
  });

  it('keeps raw-text element content as text', () => {
    expect(parseHtml('<script><b>x</b></SCRIPT>y')).toEqual([
      { name: 'script', children: [text('<b>x</b>')] },
      text('y'),
    ]);
  });

  it('reads </br> as <br>, and a lone < as text', () => {
    expect(parseHtml('a</br>b < c')).toEqual([text('a'), { name: 'br', children: [] }, text('b < c')]);
  });

  it('closes whatever is still open at the end', () => {
    expect(parseHtml('<div><b>x')).toEqual([
      { name: 'div', children: [{ name: 'b', children: [text('x')] }] },
    ]);
  });
});

describe('sanitizeNodes', () => {
  it('lowercases names and decodes text', () => {
    expect(sanitizeNodes([{ name: 'STRONG', children: [{ type: 'text', text: 'a&nbsp;b' }] }])).toEqual([
      { kind: 'element', name: 'strong', attrs: {}, children: [{ kind: 'text', text: 'a\u00a0b' }] },
    ]);
  });

  it('removes an untrusted node with its subtree and warns once per tag name', () => {
    const out = sanitizeNodes(sanitizeInput('<p>a</p><script>x</script><script>y</script><iframe><b>z</b></iframe>'));
    expect(out).toEqual([{ kind: 'element', name: 'p', attrs: {}, children: [{ kind: 'text', text: 'a' }] }]);
    const messages = warn.mock.calls.map((call) => String(call[0]));
    expect(messages.filter((m) => m.includes('<script>'))).toHaveLength(1);
    expect(messages.filter((m) => m.includes('<iframe>'))).toHaveLength(1);
  });

  it('keeps class, style and the tag’s own attributes only', () => {
    const out = sanitizeNodes([
      { name: 'div', attrs: { id: 'x', class: 'c', style: 'color:red', onclick: 'bad()' } },
      { name: 'img', attrs: { src: 'a.png', width: 20, alt: 'a', title: 't' } },
      { name: 'td', attrs: { colspan: '2', align: 'center' } },
      { name: 'ol', attrs: { START: '3', type: 'a', reversed: '' } },
    ]);
    expect(out.map((n) => (n.kind === 'element' ? n.attrs : null))).toEqual([
      { class: 'c', style: 'color:red' },
      { src: 'a.png', width: '20', alt: 'a' },
      { colspan: '2' },
      { start: '3', type: 'a' },
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('drops malformed nodes with a warning instead of throwing', () => {
    const out = sanitizeNodes([
      null,
      'str',
      { type: 'text' },
      { attrs: {} },
      { type: 'weird', name: 'p' },
      { type: 'text', text: 7 },
    ]);
    expect(out).toEqual([{ kind: 'text', text: '7' }]);
    expect(warn).toHaveBeenCalled();
  });

  it('treats a non-array as empty', () => {
    expect(sanitizeNodes(undefined)).toEqual([]);
    expect(sanitizeNodes({ name: 'p' })).toEqual([]);
  });
});

function sanitizeInput(html: string) {
  return parseHtml(html);
}
