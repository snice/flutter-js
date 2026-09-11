// specs/034-rich-text: trusted tree → view / text / image / divider.
// layout.ts is the pure-data half both platforms share, so the render tree
// asserted here is exactly what each host receives.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatOrdinal, layoutRichText, type RenderChild, type RenderElement } from '../src/rich-text/layout';
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

const lay = (html: string, space?: string) =>
  layoutRichText(sanitizeNodes(parseHtml(html)), { space });

const el = (child: RenderChild | undefined): RenderElement => {
  if (!child || typeof child === 'string') throw new Error(`expected an element, got ${JSON.stringify(child)}`);
  return child;
};

/** The strings of a paragraph, spans flattened. */
const plain = (child: RenderChild): string =>
  typeof child === 'string' ? child : (child.children ?? []).map(plain).join('');

const NBSP = '\u00a0';

describe('paragraphs', () => {
  it('folds inline content into one text with nested spans', () => {
    expect(lay('<div>a<b>b</b>c</div>')).toEqual([
      {
        tag: 'view',
        children: [
          { tag: 'text', children: ['a', { tag: 'text', style: { fontWeight: 'bold' }, children: ['b'] }, 'c'] },
        ],
      },
    ]);
  });

  it('does not wrap a plain inline element (span / a / font) in a span', () => {
    expect(lay('<p><span>a</span><a>b</a></p>')[0]).toEqual({
      tag: 'view',
      style: { marginTop: 14, marginBottom: 14 },
      children: [{ tag: 'text', children: ['a', 'b'] }],
    });
  });

  it('keeps class and style on a span', () => {
    const [p] = lay('<p><span class="hl" style="color: #07c160">x</span></p>');
    expect(el(el(el(p).children![0]).children![0])).toEqual({
      tag: 'text',
      style: { color: '#07c160' },
      class: 'hl',
      children: ['x'],
    });
  });

  it('splits an inline element around a block inside it', () => {
    const out = lay('<b>x<p>y</p>z</b>');
    expect(out.map((c) => el(c).tag)).toEqual(['text', 'view', 'text']);
    const bold = { tag: 'text', style: { fontWeight: 'bold' } };
    expect(el(out[0]).children).toEqual([{ ...bold, children: ['x'] }]);
    expect(el(el(out[1]).children![0]).children).toEqual([{ ...bold, children: ['y'] }]);
    expect(el(out[2]).children).toEqual([{ ...bold, children: ['z'] }]);
  });

  it('drops whitespace between blocks', () => {
    const [div] = lay('<div>\n  <p>a</p>\n  <p>b</p>\n</div>');
    expect(el(div).children).toHaveLength(2);
  });
});

describe('whitespace', () => {
  it('collapses runs across span boundaries and trims the paragraph', () => {
    const [p] = lay('<p>  a \n\t <b> b </b>  c  </p>');
    expect(el(el(p).children![0]).children).toEqual([
      'a ',
      { tag: 'text', style: { fontWeight: 'bold' }, children: ['b '] },
      'c',
    ]);
  });

  it('turns br into a newline, drops the space before it, and a trailing one', () => {
    const [p] = lay('<p>a <br> b<br></p>');
    expect(el(el(p).children![0]).children).toEqual(['a', '\n', 'b']);
  });

  it('keeps spaces, tabs and newlines in pre, minus the leading newline', () => {
    const [pre] = lay('<pre>\n  a\n\tb\n</pre>');
    expect(el(pre).style).toMatchObject({ fontFamily: 'monospace' });
    expect(plain(el(pre))).toBe(`${NBSP}${NBSP}a\n${NBSP.repeat(4)}b`);
  });

  it('space= keeps every space as the given character', () => {
    expect(plain(lay('<p>a  b</p>', 'nbsp')[0])).toBe(`a${NBSP}${NBSP}b`);
    expect(plain(lay('<p>a  b</p>', 'ensp')[0])).toBe('a\u2002\u2002b');
    expect(plain(lay('<p>a  b</p>', 'emsp')[0])).toBe('a\u2003\u2003b');
    expect(warn).not.toHaveBeenCalled();
  });

  it('an unknown space value warns and collapses', () => {
    expect(plain(lay('<p>a  b</p>', 'wide')[0])).toBe('a b');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('drops a paragraph that is only whitespace', () => {
    expect(lay('<div> \n </div>')).toEqual([{ tag: 'view', children: [] }]);
  });
});

describe('lists', () => {
  const markers = (list: RenderChild) =>
    el(list).children!.map((row) => plain(el(row).children![0]));

  it('numbers ol from start in the given type', () => {
    expect(markers(lay('<ol start="3" type="A"><li>x</li><li>y</li></ol>')[0])).toEqual(['C.', 'D.']);
    expect(markers(lay('<ol type="i"><li>x</li><li>y</li><li>z</li><li>w</li></ol>')[0])).toEqual([
      'i.', 'ii.', 'iii.', 'iv.',
    ]);
  });

  it('picks ul markers by depth and drops the nested list margin', () => {
    const [outer] = lay('<ul><li>a<ul><li>b<ul><li>c<ul><li>d</li></ul></li></ul></li></ul></li></ul>');
    expect(markers(outer)).toEqual(['•']);
    const inner = (row: RenderChild) => el(el(el(row).children![1]).children![1]);
    const level2 = inner(el(outer).children![0]);
    expect(markers(level2)).toEqual(['◦']);
    expect(el(level2).style).toMatchObject({ marginTop: 0, marginBottom: 0 });
    const level3 = inner(el(level2).children![0]);
    // U+25A0, not U+25AA: the latter is an emoji code point (tofu on iOS)
    expect(markers(level3)).toEqual(['■']);
    expect(markers(inner(el(level3).children![0]))).toEqual(['■']);
  });

  it('lays an item out as a marker cell and a content column', () => {
    const row = el(el(lay('<ul><li>x</li></ul>')[0]).children![0]);
    expect(row.style).toMatchObject({ flexDirection: 'row', alignItems: 'flex-start' });
    expect(el(row.children![0]).style).toMatchObject({ width: 40, textAlign: 'right', flexShrink: 0 });
    expect(el(row.children![1]).style).toMatchObject({ flexGrow: 1 });
  });

  it('formats ordinals the way browsers do', () => {
    expect(formatOrdinal(27, 'a')).toBe('aa');
    expect(formatOrdinal(3999, 'I')).toBe('MMMCMXCIX');
    expect(formatOrdinal(0, 'A')).toBe('0');
    expect(formatOrdinal(4000, 'i')).toBe('4000');
    expect(formatOrdinal(7, 'x')).toBe('7');
  });
});

describe('tables', () => {
  it('becomes rows of cells; th is bold and centred; width fixes a cell', () => {
    const [table] = lay(
      '<table><caption>cap</caption><thead><tr><th>A</th><th width="60">B</th></tr></thead>' +
        '<tbody><tr><td>1</td><td width="60">2</td></tr></tbody></table>',
    );
    const [caption, head, body] = el(table).children!.map(el);
    expect(plain(caption)).toBe('cap');
    expect(caption.style).toMatchObject({ textAlign: 'center' });
    expect(head.style).toMatchObject({ flexDirection: 'row' });
    const [a, b] = head.children!.map(el);
    expect(a.style).toMatchObject({ fontWeight: 'bold', textAlign: 'center', flexGrow: 1 });
    expect(b.style).toMatchObject({ width: 60, flexShrink: 0 });
    expect(b.style).not.toHaveProperty('flexGrow');
    expect(body.children!.map(plain)).toEqual(['1', '2']);
  });

  it('wraps stray cells in a row and warns once about colspan / rowspan', () => {
    const [table] = lay('<table><td colspan="2">a</td><td colspan="3">b</td><td rowspan="2">c</td></table>');
    expect(el(table).children).toHaveLength(1);
    expect(el(el(table).children![0]).children).toHaveLength(3);
    const messages = warn.mock.calls.map((call) => String(call[0]));
    expect(messages.filter((m) => m.includes('colspan'))).toHaveLength(1);
    expect(messages.filter((m) => m.includes('rowspan'))).toHaveLength(1);
  });
});

describe('margins', () => {
  it('collapses default margins between siblings into the larger one', () => {
    const blocks = lay('<h2>t</h2><p>a</p><p>b</p>').map(el);
    expect(blocks.map((b) => [b.style!.marginTop, b.style!.marginBottom])).toEqual([
      [17.43, 0],
      [17.43, 0],
      [14, 14],
    ]);
  });

  it('leaves a margin the page wrote alone', () => {
    const blocks = lay('<p>a</p><p style="margin-top: 30px">b</p>').map(el);
    expect(blocks[0].style!.marginBottom).toBe(14);
    expect(blocks[1].style!.marginTop).toBe(30);
  });
});

describe('inline boxes and the rest', () => {
  it('keeps an img on the line, with widthFix for a lone width', () => {
    const [p] = lay('<p>a <img src="x.png" width="10"> b</p>');
    expect(el(el(p).children![0]).children).toEqual([
      'a ',
      { tag: 'image', style: { width: 10 }, props: { src: 'x.png', mode: 'widthFix' } },
      ' b',
    ]);
  });

  it('sizes an img from its attributes', () => {
    const image = (html: string) => el(el(el(lay(html)[0]).children![0]).children![0]);
    expect(image('<p><img src="x" height="8"></p>')).toMatchObject({ style: { height: 8 }, props: { mode: 'heightFix' } });
    expect(image('<p><img src="x" width="8px" height="9"></p>')).toEqual({
      tag: 'image',
      style: { width: 8, height: 9 },
      props: { src: 'x' },
    });
    expect(image('<p><img src="x"></p>')).toMatchObject({ style: { maxWidth: '100%' } });
    expect(image('<p><img src="x" width="50%"></p>')).toMatchObject({ style: { maxWidth: '100%' } });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('drops an img without src', () => {
    expect(lay('<p><img alt="x"></p>')).toEqual([{ tag: 'view', style: { marginTop: 14, marginBottom: 14 }, children: [] }]);
  });

  it('renders hr, q, sub and sup', () => {
    expect(el(lay('<hr>')[0])).toEqual({ tag: 'divider', style: { marginTop: 7, marginBottom: 7 } });
    expect(plain(lay('<p><q>x</q></p>')[0])).toBe('“x”');
    const [p] = lay('<p>H<sub>2</sub>O x<sup>2</sup></p>');
    const spans = el(el(p).children![0]).children!.filter((c) => typeof c !== 'string').map(el);
    expect(spans.map((s) => s.style!.verticalAlign)).toEqual(['sub', 'super']);
  });
});
