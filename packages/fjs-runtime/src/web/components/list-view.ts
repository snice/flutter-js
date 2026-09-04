// `list-view` for the web renderer: a real virtual list.
//
// Flutter gets its virtualization for free — the mirror tree's `list-view`
// becomes a ListView.builder, which only ever builds the rows a Sliver asks
// for, so ../../components/list-view.ts just has to keep feeding it items.
// A browser has no such builder: every child handed to <list-view> becomes a
// DOM node that is laid out, styled and painted. Appending 200 rows (and
// never dropping them) is 200 subtrees the browser keeps alive.
//
// So on web the component windows instead: it mounts the rows that intersect
// the viewport plus `prefetchExtent` of runway on each side, and stands two
// spacer elements in for everything above and below. The scroller keeps its
// full `items.length * itemHeight` height, so the scrollbar, the wheel and
// the scroll restore in app/web.ts all behave as if every row were there.
//
// The window is index math over a fixed row height, so rows must actually be
// `itemHeight` tall — the same assumption the Flutter side's preload math
// makes. Rows of other heights only need the prop set; rows of *varying*
// heights are not supported by either platform.
import { Fragment, computed, defineComponent, h, onBeforeUnmount, ref, type PropType, type VNode } from 'vue';
import { hostAttrs } from '../style';
import { dragPanBindings, mergeBindings, pressBindings } from './gestures';
import {
  DEFAULT_LIST_ITEM_HEIGHT,
  DEFAULT_LIST_PREFETCH_EXTENT,
  DEFAULT_LIST_PRELOAD_EXTENT,
} from '../../components/list-view';
import { scrollPayload } from '../../scroll/metrics';

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const FjsListView = defineComponent({
  name: 'FjsListView',
  inheritAttrs: false,
  props: {
    /** Enables data-driven virtualization. Omit to use static children. */
    items: { type: Array as PropType<unknown[]>, default: undefined },
    /** Fixed row height; override only when rows are not 64px high. */
    itemHeight: { type: Number, default: DEFAULT_LIST_ITEM_HEIGHT },
    /** Row extent mounted before the viewport has been measured. */
    preloadExtent: { type: Number, default: DEFAULT_LIST_PRELOAD_EXTENT },
    /** Mounted runway kept on each side of the viewport. */
    prefetchExtent: { type: Number, default: DEFAULT_LIST_PREFETCH_EXTENT },
  },
  emits: ['scroll', 'tap', 'longPress'],
  setup(props, { attrs, slots, emit }) {
    const press = pressBindings(emit);
    const host = ref<HTMLElement | null>(null);
    const pan = dragPanBindings(host);

    const horizontal = computed(() => attrs.direction === 'horizontal');
    const offset = ref(0);
    // Zero until the element is in the document; `preloadExtent` stands in
    // for the viewport for that first render, so the list paints rows rather
    // than an empty scroller waiting on a measurement.
    const viewport = ref(0);

    const itemExtent = computed(() =>
      positive(props.itemHeight, DEFAULT_LIST_ITEM_HEIGHT),
    );
    const slice = computed(() => {
      const items = props.items;
      if (!items) return null;
      const extent = itemExtent.value;
      const runway = positive(props.prefetchExtent, DEFAULT_LIST_PREFETCH_EXTENT);
      const visible =
        viewport.value ||
        positive(props.preloadExtent, DEFAULT_LIST_PRELOAD_EXTENT);
      const start = Math.max(
        0,
        Math.min(
          items.length,
          Math.floor((offset.value - runway) / extent),
        ),
      );
      const end = Math.max(
        start,
        Math.min(
          items.length,
          Math.ceil((offset.value + visible + runway) / extent),
        ),
      );
      return { start, end, total: items.length };
    });

    let measureQueued = false;
    const measure = () => {
      const el = host.value;
      if (!el) return;
      viewport.value = horizontal.value ? el.clientWidth : el.clientHeight;
      offset.value = Math.max(
        0,
        horizontal.value ? el.scrollLeft : el.scrollTop,
      );
    };

    let observer: ResizeObserver | null = null;
    const setHost = (el: unknown) => {
      const next = (el as HTMLElement | null) ?? null;
      if (next === host.value) return;
      observer?.disconnect();
      observer = null;
      host.value = next;
      if (!next) return;
      measure();
      if (typeof ResizeObserver === 'function') {
        observer = new ResizeObserver(measure);
        observer.observe(next);
      }
    };
    onBeforeUnmount(() => {
      observer?.disconnect();
      observer = null;
    });

    // Browser scrolls arrive faster than a frame; Flutter already coalesces
    // its native notifications, so one shared queue keeps the two platforms
    // reporting at the same rate — and keeps the window to one recompute and
    // one patch per frame.
    let scrollQueued = false;
    let lastReported = 0;
    const onScroll = (event: Event) => {
      const el = (event.currentTarget as HTMLElement | null) ?? host.value;
      if (!el) return;
      const next = Math.max(0, horizontal.value ? el.scrollLeft : el.scrollTop);
      if (scrollQueued) {
        offset.value = next;
        return;
      }
      scrollQueued = true;
      const flush = () => {
        scrollQueued = false;
        // The six-field payload both platforms send (../../scroll/metrics).
        const scroller = host.value;
        emit(
          'scroll',
          scrollPayload({
            scrollTop: horizontal.value ? 0 : offset.value,
            scrollLeft: horizontal.value ? offset.value : 0,
            scrollHeight: horizontal.value ? 0 : scroller?.scrollHeight ?? 0,
            scrollWidth: horizontal.value ? scroller?.scrollWidth ?? 0 : 0,
            deltaX: horizontal.value ? offset.value - lastReported : 0,
            deltaY: horizontal.value ? 0 : offset.value - lastReported,
          }),
        );
        lastReported = offset.value;
      };
      offset.value = next;
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(flush);
      } else {
        flush();
      }
    };

    const spacer = (extent: number, key: string): VNode =>
      h('view', {
        key,
        'aria-hidden': 'true',
        style: horizontal.value
          ? { width: `${extent}px`, flexShrink: 0 }
          : { height: `${extent}px`, flexShrink: 0 },
      });

    return () => {
      let children: VNode[] | undefined;
      const win = slice.value;
      if (!win) {
        children = slots.default?.();
      } else {
        const items = props.items ?? [];
        const extent = itemExtent.value;
        const rows: VNode[] = [];
        if (win.start > 0) rows.push(spacer(win.start * extent, 'fjs-lead'));
        for (let index = win.start; index < win.end; index += 1) {
          // Keyed by absolute index: scrolling shifts the window by a row or
          // two, and the keyed diff then reuses every row the two windows
          // share instead of re-rendering the whole visible list.
          const row = slots.default?.({ item: items[index], index }) ?? [];
          rows.push(
            row.length === 1 && row[0].key != null
              ? row[0]
              : h(Fragment, { key: index }, row),
          );
        }
        if (win.end < win.total) {
          rows.push(spacer((win.total - win.end) * extent, 'fjs-trail'));
        }
        children = rows;
      }
      return h(
        'list-view',
        {
          ...mergeBindings(hostAttrs(attrs), press, pan),
          ref: setHost,
          onScroll,
        },
        children,
      );
    };
  },
});
