// Gesture plumbing shared by the web tag implementations: the tap /
// long-press contract of Flutter's GestureDetector, and the mouse drag
// panning its scrollables get from FjsMouseDragScrollBehavior.
import { defineComponent, h, type Ref } from 'vue';
import { hostAttrs } from '../style';

const LONG_PRESS_MS = 500;

type Emit = (event: never, ...args: unknown[]) => void;

/** Pointer bindings that reproduce GestureDetector's tap + long press.
 * A fired long press swallows the click that follows it, like Flutter. */
export function pressBindings(emit: Emit) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let fired = false;
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return {
    onPointerdown: () => {
      fired = false;
      cancel();
      timer = setTimeout(() => {
        fired = true;
        emit('longPress' as never);
      }, LONG_PRESS_MS);
    },
    onPointerup: cancel,
    onPointercancel: cancel,
    onPointerleave: cancel,
    onClick: (event: MouseEvent) => {
      if (fired) {
        fired = false;
        event.stopPropagation();
        return;
      }
      emit('tap' as never);
    },
  };
}

/** Mouse drag panning for a scrollable.
 *
 * The renderer hands every Flutter scrollable a ScrollBehavior that accepts
 * mouse drags (desktop Flutter leaves them out), while a browser only pans a
 * scroller with the wheel or a finger — so dragging one with the mouse is
 * done by hand here. Touch keeps the platform's own momentum scrolling. */
export function dragPanBindings(host: Ref<HTMLElement | null>) {
  let from: { x: number; y: number; left: number; top: number } | null = null;
  let panned = false;
  const swallowClick = (event: Event) => {
    event.stopPropagation();
    event.preventDefault();
  };
  const onPointerdown = (event: PointerEvent) => {
    const el = host.value;
    if (!el || event.pointerType === 'touch' || event.button !== 0) return;
    from = {
      x: event.clientX,
      y: event.clientY,
      left: el.scrollLeft,
      top: el.scrollTop,
    };
    panned = false;
  };
  const onPointermove = (event: PointerEvent) => {
    const el = host.value;
    if (!from || !el) return;
    const dx = event.clientX - from.x;
    const dy = event.clientY - from.y;
    // a few pixels of slop first, so a click on a row stays a click
    if (!panned && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    if (!panned) {
      panned = true;
      el.setPointerCapture(event.pointerId);
    }
    event.preventDefault(); // otherwise the drag selects text
    el.scrollLeft = from.left - dx;
    el.scrollTop = from.top - dy;
  };
  const onPointerup = () => {
    from = null;
    if (!panned) return;
    panned = false;
    // the release would otherwise land as a tap on whatever ended up under
    // the cursor — a drag is not a tap on either platform
    host.value?.addEventListener('click', swallowClick, {
      capture: true,
      once: true,
    });
  };
  return {
    onPointerdown,
    onPointermove,
    onPointerup,
    onPointercancel: onPointerup,
  };
}

/** Container-ish tags all share tap/long-press and attr pass-through. */
export function container(tag: string, hostTag = tag) {
  return defineComponent({
    name: `Fjs${tag}`,
    inheritAttrs: false,
    emits: ['tap', 'longPress'],
    setup(_props, { attrs, slots, emit }) {
      const press = pressBindings(emit);
      return () => h(hostTag, { ...hostAttrs(attrs), ...press }, slots.default?.());
    },
  });
}
