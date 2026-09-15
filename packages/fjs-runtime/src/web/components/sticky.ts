// sticky-header / sticky-section (specs/052). The web substrate is CSS
// `position: sticky`, which pins an element within its PARENT's box — that
// is exactly the semantics: a header inside a sticky-section leaves with the
// section, and a direct scroll-view child pins for the whole scroll. The
// Dart side earns the same behaviour with pinned SliverPersistentHeaders
// inside a SliverMainAxisGroup (widgets/sticky.dart); the two agree on the
// props and on the stickontopchange payload, which is what lets one page run
// unchanged (constitution I).
//
// `stickontopchange` is measured, not observed: CSS sticky fires no event.
// A scroll listener on the nearest scrollable ancestor (fjs pages scroll
// inside scroll-view elements; window is the fallback) recomputes the pin
// state per frame and emits only on a flip — the same one-event-per-state
// rule the scroll edge events follow (scroll/metrics.ts).
import { defineComponent, h, onBeforeUnmount, onMounted, ref } from 'vue';
import { hostAttrs } from '../style';
import { mergeBindings, pressBindings } from './gestures';

/** `<sticky-section>`: a plain block container. push-pinned-header is the
 * WeChat prop; CSS sticky already bounds each header to this box, which is
 * the between-sections push behaviour, so the prop has nothing to change —
 * several headers INSIDE one section cover each other instead of pushing
 * (spec 052 §4 registers the difference). */
export const FjsStickySection = defineComponent({
  name: 'FjsStickySection',
  inheritAttrs: false,
  emits: ['tap', 'longPress'],
  setup(_props, { attrs, slots, emit }) {
    const press = pressBindings(emit);
    return () =>
      h(
        'sticky-section',
        mergeBindings(hostAttrs(attrs), press),
        slots.default?.(),
      );
  },
});

export const FjsStickyHeader = defineComponent({
  name: 'FjsStickyHeader',
  inheritAttrs: false,
  props: {
    /** Pin distance from the scroll viewport's top, px (WeChat offset-top). */
    offsetTop: { type: [Number, String], default: 0 },
    /** WeChat 3.0.0 props, accepted so a page runs unchanged; inert here —
     * padding belongs on an inner node, and overlap handling would need
     * measured pushes that CSS cannot express (spec 052 §2). */
    padding: { type: Array, default: undefined },
    allowOverlapping: { type: Boolean, default: false },
  },
  emits: ['tap', 'longPress', 'stickontopchange'],
  setup(props, { attrs, slots, emit }) {
    const press = pressBindings(emit);
    const host = ref<HTMLElement | null>(null);

    let scroller: HTMLElement | null = null;
    let naturalTop: number | null = null;
    let stuck = false;
    let queued = false;

    const offsetTop = () => {
      const n = Number(props.offsetTop);
      return Number.isFinite(n) ? n : 0;
    };

    const findScroller = (): HTMLElement | null => {
      let node = host.value?.parentElement;
      while (node) {
        const overflow = getComputedStyle(node).overflowY;
        if (overflow === 'auto' || overflow === 'scroll') return node;
        node = node.parentElement;
      }
      return null;
    };

    /** Stuck ⇔ the edge is held at the pin line while the scroller has
     * actually scrolled far enough to reach it. The second half matters for
     * a header whose natural position is already above the line: it sits
     * there because the layout put it there, not because it stuck.
     *
     * naturalTop (the element's offset inside the scroll content) can only
     * be sampled while the element is visibly BELOW the pin line — a pinned
     * element would report the line itself and confirm its own state. */
    const measure = (silent = false) => {
      const el = host.value;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // Not laid out yet (mount before the first layout pass, a display:none
      // ancestor): the all-zero rect would read as "naturally at the pin
      // line" and prime the state backwards. Skip and wait for a scroll.
      if (rect.top === 0 && rect.height === 0) return;
      const line = offsetTop();
      // getBoundingClientRect is viewport-relative, but the pin line hangs
      // off the SCROLLER's top — a page usually scrolls the scroller while
      // it sits mid-page, so the header's viewport top never reaches 0.
      const scrollerTop = scroller
        ? scroller.getBoundingClientRect().top
        : 0;
      const inScrollerTop = rect.top - scrollerTop;
      const scrollTop = scroller ? scroller.scrollTop : window.scrollY;
      if (inScrollerTop > line + 1) naturalTop = inScrollerTop + scrollTop;
      // Held AT the line — an edge above it (negative top) is the header
      // being pushed out, not a pinned one.
      const next =
        Math.abs(inScrollerTop - line) <= 0.5 &&
        scrollTop + line >= (naturalTop ?? 0) - 1;
      if (next !== stuck) {
        stuck = next;
        if (!silent) {
          emit('stickontopchange', JSON.stringify({ isStickOnTop: next }));
        }
      }
    };

    // One check per frame, the rate the scroll adapter and the Dart probe
    // keep — a scroll event per wheel tick would fire the same state
    // hundreds of times.
    const schedule = () => {
      if (queued) return;
      queued = true;
      const flush = () => {
        queued = false;
        measure();
      };
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(flush);
      } else {
        flush();
      }
    };

    onMounted(() => {
      scroller = findScroller();
      const target: HTMLElement | Window = scroller ?? window;
      // The initial state is registered silently: the event reports
      // CHANGES, and a header sitting naturally at the top has not stuck
      // yet (the same call the scroll edge events made — opening at the
      // top is not "the user reached the top").
      measure(true);
      target.addEventListener('scroll', schedule, { passive: true });
    });
    onBeforeUnmount(() => {
      const target: HTMLElement | Window = scroller ?? window;
      target.removeEventListener('scroll', schedule);
    });

    return () => {
      // The base stylesheet pins at top: 0; the prop moves the line by
      // overriding it inline (user style comes later and wins where it
      // speaks — the same order base-css + inline style always have).
      const top = `top: ${offsetTop()}px`;
      const rest = attrs as Record<string, unknown>;
      const own = rest.style as string | undefined;
      const bound = mergeBindings(hostAttrs({
        ...rest,
        style: own ? `${own};${top}` : top,
      }), press);
      return h(
        'sticky-header',
        { ...bound, ref: host },
        slots.default?.(),
      );
    };
  },
});
