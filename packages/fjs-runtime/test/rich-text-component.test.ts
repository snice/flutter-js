// @vitest-environment happy-dom
// specs/034-rich-text: the component on the web substrate — the same
// FjsRichText the Flutter path mounts, rendering the web adapter's view /
// text / image components (web/components/index.ts). What the render tree
// looks like is pinned by rich-text-layout.test.ts; this file checks what
// only a mounted component can show: the substrate lookup, the page's scope
// on inner nodes, updates, the root's @tap and the prop warnings.
//
// specs/035: a paragraph's runs arrive as the internal `richSpans` prop and
// the web `text` renders them as <span>s.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref, resolveComponent, type Component } from 'vue';
import { fjsComponents } from '../src/web/components';
import { resetRichTextWarnOnce } from '../src/rich-text/warn';

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetRichTextWarnOnce();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function mount(render: () => unknown, scopeId?: string) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const Page = defineComponent({ render }) as Component & { __scopeId?: string };
  if (scopeId) Page.__scopeId = scopeId;
  const app = createApp(Page);
  for (const [tag, component] of Object.entries(fjsComponents)) {
    app.component(tag, component as Component);
  }
  app.mount(host);
  return host;
}

const richText = (props: Record<string, unknown>) => h(resolveComponent('rich-text') as Component, props);

describe('rich-text on the web', () => {
  it('renders a paragraph as one text with its runs as spans', async () => {
    const host = mount(() => richText({ nodes: '<p>a<b>b</b></p>' }));
    await nextTick();
    const root = host.firstElementChild!;
    expect(root.tagName.toLowerCase()).toBe('view');
    // the <p> and its paragraph are one text
    const paragraph = root.firstElementChild as HTMLElement;
    expect(paragraph.tagName.toLowerCase()).toBe('text');
    expect(paragraph.textContent).toBe('ab');
    expect(paragraph.querySelector('text')).toBeNull();
    const span = paragraph.querySelector('span') as HTMLElement;
    expect(span.textContent).toBe('b');
    expect(span.style.fontWeight).toBe('bold');
    // the internal prop is consumed, not written to the DOM
    expect(paragraph.hasAttribute('richspans')).toBe(false);
    expect(paragraph.hasAttribute('richSpans')).toBe(false);
    // default margins crossed the web style normaliser as px
    expect(paragraph.style.marginTop).toBe('14px');
  });

  it('keeps nested text spans for a class, and px on a span style', async () => {
    const host = mount(() => richText({ nodes: '<p>x <span class="hl" style="font-size: 20px">y</span></p>' }));
    await nextTick();
    const span = host.querySelector('text.hl') as HTMLElement;
    expect(span).not.toBeNull();
    expect(span.parentElement!.tagName.toLowerCase()).toBe('text');
    expect(span.style.fontSize).toBe('20px');
  });

  it('renders img as the adapter image, inside the paragraph', async () => {
    const host = mount(() => richText({ nodes: '<p>x <img src="/a.png" width="18"> y</p>' }));
    await nextTick();
    const img = host.querySelector('img.fjs-image') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.parentElement!.tagName.toLowerCase()).toBe('text');
    expect(img.getAttribute('src')).toBe('/a.png');
  });

  it("stamps the page's scope on every inner node", async () => {
    const host = mount(
      () => richText({ nodes: '<div style="padding: 4px"><p><span class="hl">x</span></p><p>y <b>z</b></p></div>' }),
      'data-v-page',
    );
    await nextTick();
    const inner = [...host.querySelectorAll('view, text')];
    // root, the padded div, two paragraphs, the classed span
    expect(inner.length).toBeGreaterThanOrEqual(5);
    for (const el of inner) expect(el.hasAttribute('data-v-page')).toBe(true);
    expect(host.querySelector('text.hl')).not.toBeNull();
  });

  it('rebuilds when nodes changes', async () => {
    const nodes = ref<string | unknown[]>('<p>A</p>');
    const host = mount(() => richText({ nodes: nodes.value }));
    await nextTick();
    expect(host.textContent).toBe('A');
    nodes.value = [{ name: 'ul', children: [{ name: 'li', children: [{ type: 'text', text: 'B' }] }] }];
    await nextTick();
    expect(host.textContent).toBe('•B');
    nodes.value = '<p>C <b>D</b></p>';
    await nextTick();
    expect(host.textContent).toBe('C D');
  });

  it('fires the root @tap once per click, from anywhere inside', async () => {
    const onTap = vi.fn();
    const host = mount(() => richText({ nodes: '<div><p>a <b>deep</b></p></div>', onTap }));
    await nextTick();
    // Vue's event invoker drops an event whose timestamp is not later than
    // the moment the listener was attached (runtime-dom's `_vts <= attached`
    // check, which guards against a click that triggered the patch reaching
    // the listener it just added). The first listener the click meets stamps
    // it with Date.now(); clicked in the same millisecond as the mount, the
    // root's @tap sees it as older and skips it — which made this test fail
    // about half the time. Real users cannot tap within a millisecond of a
    // mount, so let the clock move first.
    await new Promise((resolve) => setTimeout(resolve, 5));
    // .click(), as web-form.test.ts does: a hand-built MouseEvent carries a
    // timestamp Vue's invoker treats as older than the listener and drops
    const deep = [...host.querySelectorAll('span')].find((t) => t.textContent === 'deep') as HTMLElement;
    deep.click();
    await nextTick();
    expect(onTap).toHaveBeenCalledTimes(1);
    (host.firstElementChild as HTMLElement).click();
    await nextTick();
    expect(onTap).toHaveBeenCalledTimes(2);
  });

  it('warns once for user-select and a Skyline mode', async () => {
    mount(() => [
      richText({ nodes: '<p>a</p>', userSelect: true, mode: 'compat' }),
      richText({ nodes: '<p>b</p>', userSelect: '', mode: 'compat' }),
    ]);
    await nextTick();
    const messages = warn.mock.calls.map((call) => String(call[0]));
    expect(messages.filter((m) => m.includes('user-select'))).toHaveLength(1);
    expect(messages.filter((m) => m.includes('mode="compat"'))).toHaveLength(1);
  });

  it('does not warn for defaults', async () => {
    mount(() => richText({ nodes: '<p>a</p>', userSelect: false, mode: 'default' }));
    await nextTick();
    // Vue itself warns about registering `view` / `text` as component ids in
    // this bare test app; only this component's own channel matters here
    const ours = warn.mock.calls.map((call) => String(call[0])).filter((m) => m.includes('rich-text'));
    expect(ours).toEqual([]);
  });
});

describe('web text with richSpans', () => {
  const text = (props: Record<string, unknown>, children?: () => unknown) =>
    h(resolveComponent('text') as Component, props, children ? { default: children } : undefined);

  it('warns once and renders empty for a malformed prop', async () => {
    const host = mount(() => [text({ richSpans: 'nope' }), text({ richSpans: [{ t: 1 }] })]);
    await nextTick();
    expect([...host.querySelectorAll('text')].map((t) => t.textContent)).toEqual(['', '']);
    const messages = warn.mock.calls.map((call) => String(call[0]));
    expect(messages.filter((m) => m.includes('richSpans is malformed'))).toHaveLength(1);
  });

  it('is the plain container without the prop', async () => {
    const host = mount(() => text({ class: 'x' }, () => 'hello'));
    await nextTick();
    const el = host.querySelector('text.x')!;
    expect(el.textContent).toBe('hello');
    expect(el.children).toHaveLength(0);
  });
});
