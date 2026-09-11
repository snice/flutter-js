// @vitest-environment happy-dom
// specs/034-rich-text: the component on the web substrate — the same
// FjsRichText the Flutter path mounts, rendering the web adapter's view /
// text / image components (web/components/index.ts). What the render tree
// looks like is pinned by rich-text-layout.test.ts; this file checks what
// only a mounted component can show: the substrate lookup, the page's scope
// on inner nodes, updates, the root's @tap and the prop warnings.
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
  it('renders blocks as view and a paragraph as nested text', async () => {
    const host = mount(() => richText({ nodes: '<p>a<b>b</b></p>' }));
    await nextTick();
    const root = host.firstElementChild!;
    expect(root.tagName.toLowerCase()).toBe('view');
    const paragraph = root.querySelector('view > text')!;
    expect(paragraph.textContent).toBe('ab');
    const span = paragraph.querySelector('text') as HTMLElement;
    expect(span.textContent).toBe('b');
    expect(span.style.fontWeight).toBe('bold');
    // default margins crossed the web style normaliser as px
    expect((root.firstElementChild as HTMLElement).style.marginTop).toBe('14px');
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
    const host = mount(() => richText({ nodes: '<div><p><span class="hl">x</span></p></div>' }), 'data-v-page');
    await nextTick();
    const inner = [...host.querySelectorAll('view, text')];
    expect(inner.length).toBeGreaterThan(3);
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
  });

  it('fires the root @tap once per click, from anywhere inside', async () => {
    const onTap = vi.fn();
    const host = mount(() => richText({ nodes: '<div><p>a <b>deep</b></p></div>', onTap }));
    await nextTick();
    // .click(), as web-form.test.ts does: a hand-built MouseEvent carries a
    // timestamp Vue's invoker treats as older than the listener and drops
    const deep = [...host.querySelectorAll('text')].find((t) => t.textContent === 'deep') as HTMLElement;
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
