// @vitest-environment happy-dom
// specs/052: the web sticky pair. The pin EVENT is the part with logic —
// CSS sticky pins for free, but stickontopchange has to be measured from
// the element's rect against the scroll position. These cases drive one
// full flip cycle (below the line → pinned → released) through a mock
// scroller, the way the browser would deliver it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type Component } from 'vue';
import { FjsStickyHeader, FjsStickySection } from '../src/web/components/sticky';

function mount(render: () => unknown) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const app = createApp({ render } as Component);
  app.mount(el);
  return el;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('FjsStickyHeader', () => {
  it('renders a sticky-header element with offset-top as the inline pin line', () => {
    const el = mount(() => h(FjsStickyHeader, { offsetTop: 8 }, () => 'x'));
    const host = el.querySelector('sticky-header')!;
    expect(host).not.toBeNull();
    // Vue normalizes the style binding (trailing semicolon)
    expect(host.getAttribute('style')).toBe('top: 8px;');
  });

  it('merges a user style before the pin line', () => {
    const el = mount(() =>
      h(FjsStickyHeader, { offsetTop: 4, style: 'background: red' }, () => 'x'),
    );
    expect(el.querySelector('sticky-header')!.getAttribute('style')).toBe(
      'background: red; top: 4px;',
    );
  });

  it('emits stickontopchange only on flips, payload is the JSON string', async () => {
    const captured: string[] = [];
    // The structure exists BEFORE mount: the component binds its scroll
    // listener at mount time, walking up from its own element. The scroller
    // declares itself the way base-css does — overflow-y: auto — which
    // happy-dom's computed style resolves without any stubbing.
    const scroller = document.createElement('div');
    scroller.style.overflowY = 'auto';
    const app = document.createElement('div');
    scroller.appendChild(app);
    document.body.appendChild(scroller);

    const app2 = createApp({
      render: () =>
        h(FjsStickyHeader, {
          onStickontopchange: (d: string) => captured.push(d),
        }),
    } as Component);
    app2.mount(app);
    const header = app.querySelector('sticky-header')!;
    // The scroller sits MID-PAGE: the pin line hangs off the scroller's
    // top, not the viewport's — a viewport-relative read would never reach
    // the line here (specs/052 regression).
    vi.spyOn(scroller, 'getBoundingClientRect').mockImplementation(
      () => ({ top: 400 }) as DOMRect,
    );
    let inScrollerTop = 500;
    vi.spyOn(header, 'getBoundingClientRect').mockImplementation(
      () => ({ top: 400 + inScrollerTop, height: 40 }) as DOMRect,
    );

    // mount-time state registers silently: below the line, not stuck
    expect(captured).toEqual([]);

    const scroll = (top: number) => {
      scroller.scrollTop = top;
      scroller.dispatchEvent(new Event('scroll'));
      return new Promise((r) => setTimeout(r, 25));
    };

    // reach the pin line: rect held at the scroller's top while the
    // scroller consumed 500px
    inScrollerTop = 0;
    await scroll(500);
    await nextTick();
    expect(captured).toEqual(['{"isStickOnTop":true}']);

    // still pinned (micro-jitter): no repeated event
    inScrollerTop = 0.2;
    await scroll(501);
    await nextTick();
    expect(captured).toHaveLength(1);

    // pushed off: the edge moves past the line
    inScrollerTop = -30;
    await scroll(530);
    await nextTick();
    expect(captured).toEqual(['{"isStickOnTop":true}', '{"isStickOnTop":false}']);
    app2.unmount();
  });
});

describe('FjsStickySection', () => {
  it('renders a block container around its children', () => {
    const el = mount(() => h(FjsStickySection, () => h('view', () => 'x')));
    expect(el.querySelector('sticky-section')).not.toBeNull();
  });
});
