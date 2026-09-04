// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, nextTick } from 'vue';
import { FjsListView } from '../src/web/components/list-view';

const rows = Array.from({ length: 200 }, (_, i) => ({ id: i + 1 }));

function mount(props: Record<string, unknown> = {}) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const app = createApp({
    render: () =>
      h(
        FjsListView,
        { items: rows, ...props },
        {
          default: ({ item }: { item: { id: number } }) =>
            h('view', { key: item.id, class: 'row' }, String(item.id)),
        },
      ),
  });
  app.mount(el);
  return { app, host: el.querySelector('list-view') as HTMLElement };
}

async function scrollTo(host: HTMLElement, top: number) {
  Object.defineProperty(host, 'scrollTop', { value: top, configurable: true });
  host.dispatchEvent(new Event('scroll'));
  await nextTick();
  await new Promise((r) => setTimeout(r, 50));
  await nextTick();
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('web list-view virtualization', () => {
  it('mounts a window of rows, not the whole list', () => {
    const { host } = mount();
    const mounted = host.querySelectorAll('.row');
    expect(mounted.length).toBeGreaterThan(0);
    expect(mounted.length).toBeLessThan(rows.length / 2);
    // first row of the list is in the window, the last one is not
    expect(mounted[0].textContent).toBe('1');
    expect(host.textContent).not.toContain('200');
  });

  it('keeps the full scroll extent with spacers', () => {
    const { host } = mount();
    const spacers = [...host.children].filter(
      (child) => child.getAttribute('aria-hidden') === 'true',
    );
    const rowCount = host.querySelectorAll('.row').length;
    const spacerExtent = spacers.reduce(
      (sum, el) => sum + parseFloat((el as HTMLElement).style.height),
      0,
    );
    expect(spacerExtent + rowCount * 64).toBe(rows.length * 64);
  });

  it('moves the window on scroll instead of growing it', async () => {
    const { host } = mount();
    await scrollTo(host, 6000);
    const mid = [...host.querySelectorAll('.row')];
    // rows around offset 6000 (row ~94) are mounted; the top of the list is not
    expect(Number(mid[0].textContent)).toBeGreaterThan(50);
    expect(mid.some((el) => el.textContent === '1')).toBe(false);
    // and the window stays the same size the deeper the scroll goes — the
    // append-only list would be holding every row above the offset by now
    await scrollTo(host, 9000);
    const deep = [...host.querySelectorAll('.row')];
    expect(deep.length).toBeLessThanOrEqual(mid.length);
    expect(Number(deep[0].textContent)).toBeGreaterThan(
      Number(mid[0].textContent),
    );
  });

  it('reports the offset like the Flutter side does', async () => {
    let seen: unknown = null;
    const el = document.createElement('div');
    document.body.appendChild(el);
    createApp({
      render: () =>
        h(
          FjsListView,
          { items: rows, onScroll: (offset: unknown) => (seen = offset) },
          { default: ({ item }: { item: { id: number } }) => h('view', { key: item.id }) },
        ),
    }).mount(el);
    const host = el.querySelector('list-view') as HTMLElement;
    await scrollTo(host, 1234);
    // specs/009 Q3: six fields, not a bare offset string.
    expect(JSON.parse(seen as string)).toMatchObject({
      scrollTop: 1234,
      scrollLeft: 0,
      deltaY: 1234,
    });
  });

  it('keeps appending rows when the scroll reaches the bottom', async () => {
    // The regression the payload change could have caused silently: this
    // component reads scrollTop out of the payload to decide when to mount
    // the next batch (src/components/list-view.ts). Parse it wrong and the
    // list simply stops growing — no error anywhere.
    const { host } = mount();
    const before = host.querySelectorAll('.row').length;
    await scrollTo(host, before * 64 - 200);
    const after = host.querySelectorAll('.row').length;
    expect(after).toBeGreaterThan(before);
  });

  it('renders static children unchanged when items is omitted', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    createApp({
      render: () => h(FjsListView, null, { default: () => [h('view', { class: 'row' })] }),
    }).mount(el);
    expect(el.querySelectorAll('.row').length).toBe(1);
  });
});
