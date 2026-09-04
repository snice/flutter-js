// The web half of the wheel. Its Flutter twin is
// flutter_fjs/lib/src/widgets/picker_view.dart — different substrate, same
// contract: 44px rows, five of them, a hairline box in the middle, and a
// `[0,2]`-shaped payload emitted once the scroll comes to rest.
//
// Snapping is the browser's (`scroll-snap-type: y mandatory`), the way it is
// ListWheelScrollView's over there — neither side hand-rolls deceleration.
import {
  defineComponent,
  h,
  nextTick,
  onBeforeUnmount,
  onMounted,
  onUpdated,
  ref,
  watch,
} from 'vue';
import { hostAttrs } from '../style';

export const PICKER_ITEM_HEIGHT = 44;
export const PICKER_VISIBLE_ROWS = 5;

/** `scrollend` is not in older Safari; this is how long after the last
 * scroll event we call it settled. Only a fallback — where the event
 * exists it wins, so the common path stays exact. */
const SETTLE_MS = 150;

function toIndexes(value: unknown): number[] {
  if (Array.isArray(value)) return value.map((v) => Number(v) || 0);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map((v) => Number(v) || 0) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export const FjsPickerViewColumn = defineComponent({
  name: 'FjsPickerViewColumn',
  inheritAttrs: false,
  setup(_props, { attrs, slots }) {
    return () =>
      h(
        'picker-view-column',
        { ...hostAttrs(attrs), class: ['fjs-picker-column', attrs.class] },
        slots.default?.(),
      );
  },
});

export const FjsPickerView = defineComponent({
  name: 'FjsPickerView',
  inheritAttrs: false,
  props: {
    value: { type: [Array, String], default: () => [] },
    itemHeight: { type: [Number, String], default: PICKER_ITEM_HEIGHT },
    indicatorStyle: { type: String, default: '' },
  },
  emits: ['change', 'valueChanged'],
  setup(props, { attrs, slots, emit }) {
    const host = ref<HTMLElement | null>(null);
    /** What each column currently sits on — the same bookkeeping the Dart
     * side keeps, so "the page moved us" and "the user did" stay apart. */
    const indexes = ref<number[]>([]);
    const timers = new Map<number, ReturnType<typeof setTimeout>>();
    const bound = new Map<
      HTMLElement,
      { scroll: (event: Event) => void; scrollend: () => void }
    >();

    const rowHeight = () => Number(props.itemHeight) || PICKER_ITEM_HEIGHT;
    const columns = () =>
      Array.from(
        host.value?.querySelectorAll<HTMLElement>('picker-view-column') ?? [],
      );

    const scrollTo = (column: HTMLElement, index: number, smooth: boolean) => {
      const top = index * rowHeight();
      if (Math.abs(column.scrollTop - top) < 1) return;
      column.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
    };

    /** Brings the columns in line with `value`, clamped the way the mini
     * program clamps: past the end means the last item. */
    const sync = (smooth: boolean) => {
      const target = toIndexes(props.value);
      const next: number[] = [];
      columns().forEach((column, i) => {
        const count = column.childElementCount;
        let index = target[i] ?? indexes.value[i] ?? 0;
        if (!Number.isFinite(index) || index < 0 || count === 0) index = 0;
        if (count > 0 && index > count - 1) index = count - 1;
        next.push(index);
        scrollTo(column, index, smooth);
      });
      indexes.value = next;
    };

    const settled = (column: HTMLElement, i: number) => {
      if (i < 0) return;
      const index = Math.round(column.scrollTop / rowHeight());
      if (indexes.value[i] === index) return;
      const next = [...indexes.value];
      next[i] = index;
      indexes.value = next;
      const payload = JSON.stringify(next);
      emit('change', payload);
      emit('valueChanged', payload);
    };

    const onScroll = (i: number) => (event: Event) => {
      if (i < 0) return;
      const column = event.currentTarget as HTMLElement;
      // `scrollend` fires once; the timer is only for browsers without it,
      // and gets cleared on every scroll so it cannot double-report.
      if ('onscrollend' in window) return;
      clearTimeout(timers.get(i));
      timers.set(i, setTimeout(() => settled(column, i), SETTLE_MS));
    };

    const bindColumns = () => {
      const current = new Set(columns());
      for (const [column, handlers] of bound) {
        if (current.has(column)) continue;
        column.removeEventListener('scroll', handlers.scroll);
        column.removeEventListener('scrollend', handlers.scrollend);
        bound.delete(column);
      }
      for (const column of current) {
        if (bound.has(column)) continue;
        const scroll = (event: Event) => onScroll(columns().indexOf(column))(event);
        const scrollend = () => settled(column, columns().indexOf(column));
        column.addEventListener('scroll', scroll);
        column.addEventListener('scrollend', scrollend);
        bound.set(column, { scroll, scrollend });
      }
    };

    const unbindColumns = () => {
      for (const [column, handlers] of bound) {
        column.removeEventListener('scroll', handlers.scroll);
        column.removeEventListener('scrollend', handlers.scrollend);
      }
      bound.clear();
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };

    onMounted(() =>
      nextTick(() => {
        bindColumns();
        sync(false);
      }),
    );
    onUpdated(() => nextTick(bindColumns));
    onBeforeUnmount(unbindColumns);
    watch(() => props.value, () => sync(true), { deep: true });
    // A linked picker adds or drops a column; re-sync after the DOM catches up.
    watch(
      () => slots.default?.()?.length,
      () =>
        nextTick(() => {
          bindColumns();
          sync(false);
        }),
    );

    return () =>
      h(
        'picker-view',
        {
          ...hostAttrs(attrs),
          ref: host,
          class: ['fjs-picker-view', attrs.class],
          style: {
            height: `${rowHeight() * PICKER_VISIBLE_ROWS}px`,
            '--fjs-picker-item-height': `${rowHeight()}px`,
          },
        },
        [
          h('picker-view-body', { class: 'fjs-picker-body' }, slots.default?.()),
          h('picker-view-indicator', {
            class: 'fjs-picker-indicator',
            style: props.indicatorStyle || undefined,
          }),
        ],
      );
  },
});
