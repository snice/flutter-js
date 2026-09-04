// @vitest-environment happy-dom
//
// The web halves of scroll-view and swiper. The rules they implement live in
// src/scroll/metrics.ts (and are tested there directly); this file checks
// that the components actually follow them — the same cases the Dart side
// asserts in scroll_view_props_test.dart / swiper_props_test.dart.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref, type Component } from 'vue';
import { FjsScrollView } from '../src/web/components/basic';
import { FjsSwiper } from '../src/web/components/swiper';

function mount(render: () => unknown) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  createApp({ render } as Component).mount(el);
  return el;
}

/** happy-dom does not lay out, so the scroller's geometry is declared. */
function measure(
  el: HTMLElement,
  { client = 400, scroll = 1000 }: { client?: number; scroll?: number } = {},
) {
  Object.defineProperty(el, 'clientHeight', { value: client, configurable: true });
  Object.defineProperty(el, 'scrollHeight', { value: scroll, configurable: true });
  Object.defineProperty(el, 'clientWidth', { value: client, configurable: true });
  Object.defineProperty(el, 'scrollWidth', { value: scroll, configurable: true });
  el.scrollTo = ((options: ScrollToOptions) => {
    if (options.top !== undefined) el.scrollTop = options.top;
    if (options.left !== undefined) el.scrollLeft = options.left;
  }) as HTMLElement['scrollTo'];
}

async function scrollTo(el: HTMLElement, top: number) {
  Object.defineProperty(el, 'scrollTop', { value: top, configurable: true });
  el.dispatchEvent(new Event('scroll'));
  await nextTick();
  await new Promise((r) => setTimeout(r, 20));
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('scroll-view', () => {
  it('reports the six-field payload once per scroll', async () => {
    const seen: string[] = [];
    const host = mount(() =>
      h(FjsScrollView, { scrollY: true, onScroll: (v: string) => seen.push(v) }),
    );
    const el = host.querySelector('scroll-view') as HTMLElement;
    measure(el);
    await scrollTo(el, 120);

    expect(seen).toHaveLength(1);
    expect(JSON.parse(seen[0])).toEqual({
      scrollTop: 120,
      scrollLeft: 0,
      scrollHeight: 1000,
      scrollWidth: 0,
      deltaX: 0,
      deltaY: 120,
    });
  });

  it('reports an edge once on entry and again after leaving', async () => {
    const lower: number[] = [];
    const host = mount(() =>
      h(FjsScrollView, {
        scrollY: true,
        onScrolltolower: () => lower.push(1),
      }),
    );
    const el = host.querySelector('scroll-view') as HTMLElement;
    measure(el);

    await scrollTo(el, 580);
    await scrollTo(el, 600); // still in the zone
    expect(lower).toHaveLength(1);

    await scrollTo(el, 200); // left it
    await scrollTo(el, 600); // came back
    expect(lower).toHaveLength(2);
  });

  it('moves when scroll-top changes, and stays put when it does not', async () => {
    const top = ref(0);
    const host = mount(() => h(FjsScrollView, { scrollY: true, scrollTop: top.value }));
    const el = host.querySelector('scroll-view') as HTMLElement;
    measure(el);
    await nextTick();

    top.value = 300;
    await nextTick();
    await nextTick();
    expect(el.scrollTop).toBe(300);

    // the user scrolls somewhere else; a re-render with the SAME prop must
    // not drag them back
    el.scrollTop = 450;
    await nextTick();
    await nextTick();
    expect(el.scrollTop).toBe(450);
  });

  it('warns instead of silently doing nothing when scroll-into-view misses', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const host = mount(() =>
      h(FjsScrollView, { scrollY: true, scrollIntoView: 'nope' }, () => [
        h('view', { id: 'row-1' }),
      ]),
    );
    measure(host.querySelector('scroll-view') as HTMLElement);
    await nextTick();
    await nextTick();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('nope');
  });

  it('warns when both axes are asked for', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const host = mount(() =>
      h(FjsScrollView, { scrollX: true, scrollY: true, onScroll: () => {} }),
    );
    const el = host.querySelector('scroll-view') as HTMLElement;
    measure(el);
    await scrollTo(el, 100);
    expect(warn).toHaveBeenCalled();
  });
});

const pages = (count: number) =>
  Array.from({ length: count }, (_, i) => h('view', { key: i }, String(i)));

describe('swiper', () => {
  it('reports the real index, not a clone, when it wraps', async () => {
    const changes: string[] = [];
    const host = mount(() =>
      h(
        FjsSwiper,
        { circular: true, duration: 0, onPageChanged: (i: string) => changes.push(i) },
        () => pages(3),
      ),
    );
    const track = host.querySelector('swiper') as HTMLElement;
    measure(track, { client: 100, scroll: 500 });

    // three pages plus the two clones
    expect(track.querySelectorAll('swiper-item')).toHaveLength(5);

    // a wheel gesture past the last page
    for (let i = 0; i < 3; i++) {
      track.dispatchEvent(
        Object.assign(new WheelEvent('wheel', { deltaX: 40, deltaY: 0 }), {}),
      );
      await nextTick();
      await new Promise((r) => setTimeout(r, 420)); // clear the wheel lock
    }
    expect(changes).toEqual(['1', '2', '0']);
  });

  it('does not wrap without circular', async () => {
    const changes: string[] = [];
    const host = mount(() =>
      h(FjsSwiper, { onPageChanged: (i: string) => changes.push(i) }, () => pages(2)),
    );
    const track = host.querySelector('swiper') as HTMLElement;
    measure(track, { client: 100, scroll: 200 });
    expect(track.querySelectorAll('swiper-item')).toHaveLength(2);

    for (let i = 0; i < 3; i++) {
      track.dispatchEvent(new WheelEvent('wheel', { deltaX: 40, deltaY: 0 }));
      await nextTick();
      await new Promise((r) => setTimeout(r, 420));
    }
    expect(changes).toEqual(['1']); // stops at the end
  });

  it('turns pages on a timer while autoplay is on', async () => {
    vi.useFakeTimers();
    const changes: string[] = [];
    const host = mount(() =>
      h(
        FjsSwiper,
        {
          autoplay: true,
          interval: 1000,
          duration: 0,
          onPageChanged: (i: string) => changes.push(i),
        },
        () => pages(3),
      ),
    );
    const track = host.querySelector('swiper') as HTMLElement;
    measure(track, { client: 100, scroll: 300 });

    vi.advanceTimersByTime(1000);
    await nextTick();
    expect(changes).toEqual(['1']);

    // a finger goes down: the timer must not swap the page underneath it
    track.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 10, pointerType: 'touch' }),
    );
    vi.advanceTimersByTime(3000);
    await nextTick();
    expect(changes).toEqual(['1']);
  });

  it('renders one dot per page with the current one marked', async () => {
    const host = mount(() =>
      h(FjsSwiper, { indicatorDots: true }, () => pages(3)),
    );
    const dots = host.querySelectorAll('swiper-dot');
    expect(dots).toHaveLength(3);
    expect(dots[0].className).toContain('active');
    expect(dots[1].className).not.toContain('active');
  });
});
