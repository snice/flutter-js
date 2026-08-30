// swiper -> PageView.
import {
  Comment,
  Fragment,
  Text,
  defineComponent,
  h,
  onBeforeUnmount,
  ref,
  watchEffect,
  type VNode,
} from 'vue';
import { hostAttrs } from '../style';

/** One page per real child, the way PageView counts them.
 *
 * `<swiper><view v-for=... /></swiper>` hands the slot a single Fragment
 * vnode, not three views — wrapping the slot's vnodes as they come would
 * make the whole v-for one page. Flutter never sees this: the JS renderer
 * flattens fragments before the ops reach Dart, so `buildKids()` there is
 * already the list of real children. Comments (v-if anchors) and blank text
 * take no page, as [_isHidden] drops them on the Flutter side. */
function swiperPages(nodes: VNode[]): VNode[] {
  const out: VNode[] = [];
  for (const vnode of nodes) {
    if (vnode == null) continue;
    if (vnode.type === Fragment) {
      out.push(...swiperPages((vnode.children ?? []) as VNode[]));
      continue;
    }
    if (vnode.type === Comment) continue;
    if (vnode.type === Text && String(vnode.children ?? '').trim() === '') continue;
    out.push(vnode);
  }
  return out;
}

export const FjsSwiper = defineComponent({
  name: 'FjsSwiper',
  inheritAttrs: false,
  emits: ['pageChanged'],
  setup(_props, { attrs, slots, emit }) {
    // Paging is driven here rather than left to CSS scroll-snap: a fling or
    // a long drag crosses several snap points at once, while a PageView
    // turns exactly one page per gesture. The track keeps `overflow-x:
    // hidden` (still scrollable through scrollLeft) and `touch-action:
    // pan-y`, so neither the wheel nor a finger pans it behind our back.
    const track = ref<HTMLElement | null>(null);
    let index = 0;
    const pageWidth = () => Math.max(1, track.value?.clientWidth ?? 1);
    const lastPage = () => Math.max(0, (track.value?.children.length ?? 1) - 1);

    const goTo = (next: number) => {
      const el = track.value;
      if (!el) return;
      const target = Math.max(0, Math.min(lastPage(), next));
      el.scrollTo({ left: target * pageWidth(), behavior: 'smooth' });
      if (target === index) return;
      index = target;
      emit('pageChanged', String(target));
    };

    let drag: { x: number; left: number } | null = null;
    const onPointerdown = (event: PointerEvent) => {
      const el = track.value;
      if (!el || (event.pointerType === 'mouse' && event.button !== 0)) return;
      drag = { x: event.clientX, left: index * pageWidth() };
      // an enclosing scroll-view pans on drags too; the page under a
      // PageView does not move with it on Flutter either
      event.stopPropagation();
      el.setPointerCapture(event.pointerId);
    };
    const onPointermove = (event: PointerEvent) => {
      const el = track.value;
      if (!drag || !el) return;
      event.preventDefault(); // otherwise the drag selects text
      const width = pageWidth();
      // the drag never reaches past a neighbour, however far it goes
      const offset = Math.max(-width, Math.min(width, drag.x - event.clientX));
      el.scrollLeft = Math.max(
        0,
        Math.min(lastPage() * width, drag.left + offset),
      );
    };
    const onPointerup = (event: PointerEvent) => {
      if (!drag) return;
      const dx = event.clientX - drag.x;
      drag = null;
      const width = pageWidth();
      // a fifth of the page is PageView's own threshold for turning one
      goTo(index + (dx <= -width * 0.2 ? 1 : dx >= width * 0.2 ? -1 : 0));
    };

    // a resize (rotation, a split window) leaves scrollLeft between two
    // pages; PageView stays on its page across a relayout
    let observer: ResizeObserver | null = null;
    watchEffect(() => {
      observer?.disconnect();
      const el = track.value;
      if (!el || typeof ResizeObserver === 'undefined') return;
      observer = new ResizeObserver(() => {
        el.scrollLeft = index * pageWidth();
      });
      observer.observe(el);
    });
    onBeforeUnmount(() => observer?.disconnect());

    // trackpads and horizontal wheels: one page per gesture, and the
    // momentum tail of that gesture must not turn another
    let wheelLockUntil = 0;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return; // page scroll
      event.preventDefault();
      const now = Date.now();
      if (now < wheelLockUntil || event.deltaX === 0) return;
      wheelLockUntil = now + 400;
      goTo(index + (event.deltaX > 0 ? 1 : -1));
    };

    return () =>
      h(
        'swiper',
        {
          ...hostAttrs(attrs),
          class: ['fjs-swiper', attrs.class],
          ref: track,
          onPointerdown,
          onPointermove,
          onPointerup,
          onPointercancel: onPointerup,
          onWheel,
        },
        swiperPages(slots.default?.() ?? []).map((child: VNode) =>
          h('swiper-item', { class: 'fjs-swiper-item' }, [child]),
        ),
      );
  },
});
