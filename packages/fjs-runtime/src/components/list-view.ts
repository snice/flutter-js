// Data-driven list for the Flutter renderer.
//
// It only appends rows, never changes an existing row's index, which keeps
// Flutter's Sliver cache stable while scrolling: the mirror tree's rows go
// to a ListView.builder, so the ones off screen cost a mirror node and
// nothing else — the real windowing happens in widgets/list_view.dart.
//
// The web renderer cannot lean on a builder, so it has its own windowed
// implementation in ../web/components/list-view.ts; the two share this
// file's props and defaults so a page's markup means the same thing on
// both platforms.
import {
  computed,
  defineComponent,
  h,
  ref,
  watch,
  type PropType,
} from '@vue/runtime-core';

export const DEFAULT_LIST_PRELOAD_EXTENT = 800;
export const DEFAULT_LIST_ITEM_HEIGHT = 64;
export const DEFAULT_LIST_PREFETCH_EXTENT = 500;

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
    /** Maximum logical row extent mounted in the first batch. */
    preloadExtent: { type: Number, default: DEFAULT_LIST_PRELOAD_EXTENT },
    /** Remaining loaded extent that causes the next batch to append. */
    prefetchExtent: { type: Number, default: DEFAULT_LIST_PREFETCH_EXTENT },
  },
  emits: ['scroll', 'tap', 'longPress'],
  setup(props, { attrs, slots, emit }) {
    const batchSize = computed(() =>
      Math.max(
        1,
        Math.ceil(
          positive(props.preloadExtent, DEFAULT_LIST_PRELOAD_EXTENT) /
              positive(props.itemHeight, DEFAULT_LIST_ITEM_HEIGHT),
        ),
      ),
    );
    const renderedCount = ref(batchSize.value);
    const visibleItems = computed(() =>
      props.items?.slice(0, renderedCount.value) ?? [],
    );
    let scrollQueued = false;
    let pendingOffset = 0;

    watch(
      () => props.items?.length,
      (length) => {
        if (length == null) return;
        renderedCount.value = Math.min(
          length,
          Math.max(batchSize.value, renderedCount.value),
        );
      },
    );

    const consumeScroll = (offset: number) => {
      const items = props.items;
      if (items && renderedCount.value < items.length) {
        const remaining =
            renderedCount.value *
                positive(props.itemHeight, DEFAULT_LIST_ITEM_HEIGHT) -
            offset;
        if (remaining <= positive(props.prefetchExtent, DEFAULT_LIST_PREFETCH_EXTENT)) {
          renderedCount.value = Math.min(
            items.length,
            renderedCount.value + batchSize.value,
          );
        }
      }
      emit('scroll', offset.toFixed(1));
    };

    const onScroll = (payload?: string | { currentTarget?: { scrollTop?: number } }) => {
      pendingOffset = Math.max(
        0,
        typeof payload === 'string'
            ? Number(payload) || 0
            : payload?.currentTarget?.scrollTop ?? 0,
      );
      // Browser scrolls can arrive much faster than a frame. Flutter already
      // coalesces native notifications; one shared queue preserves that rate.
      if (scrollQueued) return;
      scrollQueued = true;
      const flush = () => {
        scrollQueued = false;
        consumeScroll(pendingOffset);
      };
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(flush);
      } else {
        flush();
      }
    };

    return () => {
      const children = props.items
          ? visibleItems.value.flatMap((item, index) =>
              slots.default?.({ item, index }) ?? [],
            )
          : slots.default?.();
      return h('list-view', {
        ...attrs,
        onScroll,
        onTap: () => emit('tap'),
        onLongPress: () => emit('longPress'),
      }, children);
    };
  },
});
