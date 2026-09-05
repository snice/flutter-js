// The web half of the touch events: DOM pointer events in, the same
// FjsTouchEvent objects the Flutter side sends out.
//
// Pointer events rather than DOM touch events, for two reasons: a mouse
// produces them too (so a drag written for a phone is testable in a desktop
// browser, exactly like Flutter's Listener), and pointer capture reproduces
// Flutter's routing — once a pointer goes down on a node, every move and the
// release belong to that node even if the finger leaves it.
//
// `touch-action` is plain CSS here, so a node that declares it keeps a
// parent scroller out of the gesture by itself; the browser then sends
// pointercancel when it does take over, which arrives as touchcancel.
import type { FjsEventTarget, FjsTouch, FjsTouchEvent, FjsTouchType } from '../../ui/touch';

type Handler = (event: FjsTouchEvent) => void;

interface Point {
  identifier: number;
  x: number;
  y: number;
}

interface Route {
  element: Element;
  onMove: Handler | null;
  onEnd: Handler | null;
  onCancel: Handler | null;
}

/** Every pointer currently down, in the order it went down — `touches`. */
const activePoints = new Map<number, Point>();
/** Which of them went down on a given element — `targetTouches`. */
const elementPoints = new WeakMap<Element, Set<number>>();
/** Where a pointer sequence started, so it can finish even if capture is lost. */
const routes = new Map<number, Route>();
let globalsBound = false;

/** The listening element's top-left in client coordinates, so a touch can
 * carry the DOM's offsetX/offsetY. Read per event rather than cached: the
 * box moves with every scroll, and a wrong origin is worse than a slow one
 * (it silently mis-aims a canvas' hit-testing). */
function originOf(element: Element | null): [number, number] {
  if (!element) return [0, 0];
  const rect = element.getBoundingClientRect();
  return [rect.left, rect.top];
}

function touchOf(p: Point, origin: [number, number] = [0, 0]): FjsTouch {
  return {
    identifier: p.identifier,
    x: p.x,
    y: p.y,
    clientX: p.x,
    clientY: p.y,
    pageX: p.x,
    pageY: p.y,
    screenX: p.x,
    screenY: p.y,
    offsetX: p.x - origin[0],
    offsetY: p.y - origin[1],
  };
}

function listOf(ids: Iterable<number>, origin: [number, number] = [0, 0]): FjsTouch[] {
  const out: FjsTouch[] = [];
  for (const id of ids) {
    const p = activePoints.get(id);
    if (p) out.push(touchOf(p, origin));
  }
  return out;
}

function makeEvent(
  type: FjsTouchType,
  event: PointerEvent,
  element: Element,
  changed: FjsTouch[],
): FjsTouchEvent {
  const target: FjsEventTarget = { id: element.id || '' };
  return {
    type,
    timeStamp: event.timeStamp,
    target,
    currentTarget: target,
    touches: listOf(activePoints.keys(), originOf(element)),
    targetTouches: listOf(elementPoints.get(element) ?? [], originOf(element)),
    changedTouches: changed,
    preventDefault: () => event.preventDefault(),
    stopPropagation: () => event.stopPropagation(),
  };
}

const TOUCH_PROPS = [
  ['onTouchstart', 'onTouchStart'],
  ['onTouchmove', 'onTouchMove'],
  ['onTouchend', 'onTouchEnd'],
  ['onTouchcancel', 'onTouchCancel'],
] as const;

function pick(attrs: Record<string, unknown>, names: readonly string[]): Handler | null {
  for (const name of names) {
    const value = attrs[name];
    if (typeof value === 'function') return value as Handler;
  }
  return null;
}

function targetWithin(event: PointerEvent, element: Element): boolean {
  return event.target instanceof Node && (event.target === element || element.contains(event.target));
}

function ensureGlobalFallbacks() {
  if (globalsBound || typeof window === 'undefined') return;
  globalsBound = true;
  window.addEventListener('pointermove', globalMove, true);
  window.addEventListener('pointerup', globalFinish('touchend'), true);
  window.addEventListener('pointercancel', globalFinish('touchcancel'), true);
}

function dispatchMove(event: PointerEvent, route: Route) {
  const point = activePoints.get(event.pointerId);
  if (!point || !elementPoints.get(route.element)?.has(event.pointerId)) return;
  point.x = event.clientX;
  point.y = event.clientY;
  route.onMove?.(
    makeEvent('touchmove', event, route.element, [
      touchOf(point, originOf(route.element)),
    ]),
  );
}

function dispatchFinish(type: 'touchend' | 'touchcancel', event: PointerEvent, route: Route) {
  const point = activePoints.get(event.pointerId);
  if (!point || !elementPoints.get(route.element)?.has(event.pointerId)) return;
  point.x = event.clientX;
  point.y = event.clientY;
  const changed = [touchOf(point, originOf(route.element))];
  // as in the DOM, the finger is out of `touches` by the time the end
  // event is delivered — only changedTouches still has it
  activePoints.delete(event.pointerId);
  elementPoints.get(route.element)?.delete(event.pointerId);
  routes.delete(event.pointerId);
  const handler = type === 'touchend' ? route.onEnd : route.onCancel;
  handler?.(makeEvent(type, event, route.element, changed));
}

function globalMove(event: PointerEvent) {
  const route = routes.get(event.pointerId);
  if (!route || targetWithin(event, route.element)) return;
  dispatchMove(event, route);
}

function globalFinish(type: 'touchend' | 'touchcancel') {
  return (event: PointerEvent) => {
    const route = routes.get(event.pointerId);
    if (!route || targetWithin(event, route.element)) return;
    dispatchFinish(type, event, route);
  };
}

/** Whether [attrs] carry any touch handler at all — the common case is that
 * they do not, and then nothing below runs. */
export function hasTouchHandlers(attrs: Record<string, unknown>): boolean {
  return TOUCH_PROPS.some(([lower, camel]) =>
    typeof attrs[lower] === 'function' || typeof attrs[camel] === 'function');
}

/** Strips the touch handler attrs (Vue would otherwise bind them as raw DOM
 * listeners) and returns the pointer bindings that feed them instead. */
export function touchBindings(attrs: Record<string, unknown>): Record<string, unknown> {
  const [onStart, onMove, onEnd, onCancel] = TOUCH_PROPS.map(([lower, camel]) =>
    pick(attrs, [lower, camel]));

  const down = (event: PointerEvent) => {
    const element = event.currentTarget as Element | null;
    if (!element) return;
    ensureGlobalFallbacks();
    const point: Point = { identifier: event.pointerId, x: event.clientX, y: event.clientY };
    activePoints.set(event.pointerId, point);
    let own = elementPoints.get(element);
    if (!own) elementPoints.set(element, (own = new Set()));
    own.add(event.pointerId);
    routes.set(event.pointerId, { element, onMove, onEnd, onCancel });
    // Flutter routes the rest of the sequence to the node the pointer went
    // down on; capture is how a browser does the same
    try {
      (element as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      // capture is best-effort (a pointer that ended in the same tick)
    }
    onStart?.(makeEvent('touchstart', event, element, [touchOf(point, originOf(element))]));
  };

  const move = (event: PointerEvent) => {
    const element = event.currentTarget as Element | null;
    const route = routes.get(event.pointerId);
    if (!element || !route || route.element !== element) return;
    dispatchMove(event, route);
  };

  const finish = (type: 'touchend' | 'touchcancel') => (event: PointerEvent) => {
    const element = event.currentTarget as Element | null;
    const route = routes.get(event.pointerId);
    if (!element || !route || route.element !== element) return;
    dispatchFinish(type, event, route);
  };

  const bindings: Record<string, unknown> = {
    onPointerdown: down,
    onPointermove: move,
    onPointerup: finish('touchend'),
    onPointercancel: finish('touchcancel'),
  };
  return bindings;
}

/** The touch handler attrs, so a caller can drop them before spreading the
 * rest onto a DOM element. */
export const TOUCH_ATTR_NAMES: readonly string[] = TOUCH_PROPS.flat();
