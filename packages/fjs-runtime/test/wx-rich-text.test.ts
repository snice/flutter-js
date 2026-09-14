// spec 048: rich-text on the mini program runs the shared pipeline and turns
// its layout into the data fjs-rich-node draws (src/wx/rich-text.ts).
import { describe, expect, it, vi } from 'vitest';
import { buildWxRichText, type WxRichNode } from '../src/wx/rich-text';

type Para = Extract<WxRichNode, { k: 't' }>;
type Box = Extract<WxRichNode, { k: 'v' | 'l' }>;

const texts = (nodes: WxRichNode[]): string[] =>
  nodes.flatMap((n) => (n.k === 't' ? [n.r.map((r) => r.t).join('')] : 'n' in n ? texts(n.n) : []));

describe('buildWxRichText', () => {
  it('keeps a mixed paragraph as ONE text with styled runs', () => {
    const [p] = buildWxRichText('<p>满 <b style="color:#FA5151">199</b> 减 30</p>') as Para[];
    expect(p.k).toBe('t');
    expect(p.s).toContain('margin-top:14px');
    expect(p.r.map((r) => r.t).join('')).toBe('满 199 减 30');
    expect(p.r.find((r) => r.t === '199')?.s).toMatch(/font-weight:bold;color:#FA5151|color:#FA5151.*font-weight:bold/);
  });

  it('numbers ordered lists by start / type', () => {
    const out = buildWxRichText('<ol start="3" type="A"><li>从 C 开始</li><li>D</li></ol>');
    expect(texts(out)).toEqual(['C.', '从 C 开始', 'D.', 'D']);
  });

  it('folds a table into rows of cells', () => {
    const [table] = buildWxRichText('<table><tr><td>a</td><td width="60">b</td></tr></table>') as Box[];
    expect(table.k).toBe('v');
    expect(texts([table])).toEqual(['a', 'b']);
  });

  it('a paragraph with an image becomes an inline row, gaps kept as nbsp', () => {
    const [row] = buildWxRichText('<p>小图 <img src="/a.png" width="18" height="18"> 与文字</p>') as Box[];
    expect(row.k).toBe('l');
    expect(row.n.map((n) => n.k)).toEqual(['t', 'i', 't']);
    expect((row.n[0] as Para).r[0].t).toBe('小图 ');
    expect((row.n[2] as Para).r[0].t).toBe(' 与文字');
    expect(row.n[1]).toMatchObject({ src: '/a.png', s: 'width:18px;height:18px', a: false });
    const [auto] = buildWxRichText('<img src="/b.png">') as Box[];
    expect(texts([auto])).toEqual([]);
    expect(JSON.stringify(auto)).toContain('"a":true');
  });

  it('drops untrusted tags with their content', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = buildWxRichText('<p>x</p><script>alert(1)</script><iframe>y</iframe>');
    expect(texts(out)).toEqual(['x']);
    spy.mockRestore();
  });

  it('adds the page scope to classed nodes and flattened class runs', () => {
    const [p] = buildWxRichText('<p class="lead">页面 <span class="hl">scoped</span></p>', '', 'data-v-x') as Para[];
    expect(p.c).toBe('lead data-v-x');
    expect(p.r.find((r) => r.t === 'scoped')?.c).toBe('hl data-v-x');
    expect(p.r[0].c).toBe('');
  });
});
