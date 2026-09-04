// Element API — the HTML-like UI layer. JS apps build node trees with
// h()/element functions; ops are batched per microtask and flushed to the
// native host in one frame (mirrors React Native's batched shadow commits).
import { getWriter, scheduleFlush, flushNow } from '../host';
import { decodeTouchEvent, isTouchEvent, type FjsTouchEvent } from './touch';

/** Event names accepted in props; handlers never cross the JSI boundary —
 * only their existence is sent (e.g. onTap: true) and native dispatches
 * arrive via __fjsDispatchEvent. */
const EVENT_PREFIX = 'on';
export const EventType: Record<string, number> = {
  onTap: 1,
  onClick: 1,
  onLongPress: 2,
  onTextChanged: 3,
  onSubmit: 4,
  onValueChanged: 5,
  onPageChanged: 6,
  onModalClosed: 7,
  onRefresh: 8,
  onScroll: 12,
  // 20-23: focus/blur carry the field's current text; form submit carries a
  // {name: value} JSON string (see widgets/form.dart for the shape).
  onFocus: 20,
  onBlur: 21,
  onFormSubmit: 22,
  onFormReset: 23,
  // scroll-view's edge events. The scroll event itself is 12; its payload is
  // the JSON scroll/metrics.ts writes, not a bare offset.
  // `@scrolltolower` in a template becomes `onScrolltolower` — the all-lower
  // spelling is the one that actually shows up, so it is canonical here and
  // on the Dart side; the camelCase alias is for hand-written h() calls.
  onScrolltoupper: 24,
  onScrollToUpper: 24,
  onScrolltolower: 25,
  onScrollToLower: 25,
  onLoad: 26,
  onError: 27,
  // touch: the DOM names, so `@touchstart` in a template lands here. The
  // camelCase spellings are aliases for hand-written h() calls.
  onTouchstart: 15,
  onTouchStart: 15,
  onTouchmove: 16,
  onTouchMove: 16,
  onTouchend: 17,
  onTouchEnd: 17,
  onTouchcancel: 18,
  onTouchCancel: 18,
};

/** Handler props with more than one spelling: the native side is told the
 * canonical one, so it has a single name to look for. */
const CANONICAL_EVENT_PROP: Record<string, string> = {
  onScrollToUpper: 'onScrolltoupper',
  onScrollToLower: 'onScrolltolower',
  onTouchStart: 'onTouchstart',
  onTouchMove: 'onTouchmove',
  onTouchEnd: 'onTouchend',
  onTouchCancel: 'onTouchcancel',
};

let nextId = 1;
type EventPayload = string | FjsTouchEvent | undefined;
const eventHandlers = new Map<string, (payload?: EventPayload) => void>();
const workerHandlers = new Map<number, (data: string) => void>();
/** Events that address a subsystem instead of a node (worker messages,
 * navigator callbacks). `id` is that subsystem's own handle. */
const systemHandlers = new Map<number, (id: number, payload?: string) => void>();

/** Same warn-once channel the CSS layer uses, minus the import cycle. */
const warned = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[fjs] ${message}`);
}

export function handlerKey(nodeId: number, type: number): string {
  return `${nodeId}:${type}`;
}

// ---- form bookkeeping -------------------------------------------------------
//
// A <form> has to answer "which controls are under me and what do they hold
// right now" — including a control the page never bound a value to, whose
// text exists only inside the host widget. The element layer is the one
// place that sees both halves: every prop write comes through setProps, and
// every value-bearing event comes back through the dispatcher.
//
// It lives HERE and not in the Vue renderer on purpose: this is the
// framework-agnostic layer, so a page built on the raw element API gets the
// same <form> behaviour (docs/custom-renderer.md).

/** `name` / `form-type` per node — the props a form reads structurally. */
const fieldNames = new Map<number, string>();
const fieldFormTypes = new Map<number, string>();
/** The value a control currently holds: the last bound `value` prop, then
 * whatever the user did to it. */
const fieldValues = new Map<number, string>();

export function fieldName(nodeId: number): string | undefined {
  return fieldNames.get(nodeId);
}

export function fieldFormType(nodeId: number): string | undefined {
  return fieldFormTypes.get(nodeId);
}

export function fieldValue(nodeId: number): string | undefined {
  return fieldValues.get(nodeId);
}

function recordField(nodeId: number, key: string, value: unknown): void {
  if (key === 'name') {
    if (value == null || value === '') fieldNames.delete(nodeId);
    else fieldNames.set(nodeId, String(value));
    return;
  }
  if (key === 'formType') {
    if (value == null || value === '') fieldFormTypes.delete(nodeId);
    else fieldFormTypes.set(nodeId, String(value));
    return;
  }
  if (key !== 'value') return;
  if (value == null) fieldValues.delete(nodeId);
  else fieldValues.set(nodeId, typeof value === 'boolean'
    ? (value ? '1' : '0')
    : String(value));
}

/** The distinct event type numbers (onTap and onClick are one). Dropping a
 * node's handlers walks these instead of the registry: the registry holds
 * every handler in the app, and scanning it per removed node made teardown
 * cost more the longer the app had been running. */
const EVENT_TYPES: number[] = [...new Set(Object.values(EventType))];

/** Forgets every handler registered for one node.
 *
 * Handlers outlive their node otherwise, and a handler is a closure over its
 * component's render scope — one surviving `@tap` pins the whole page it was
 * written in. The tree bookkeeping lives in the renderer, so dropping a
 * SUBTREE is its job (see forgetSubtree); this drops one node. */
export function forgetHandlers(nodeId: number): void {
  for (let i = 0; i < EVENT_TYPES.length; i++) {
    eventHandlers.delete(handlerKey(nodeId, EVENT_TYPES[i]));
  }
  fieldNames.delete(nodeId);
  fieldFormTypes.delete(nodeId);
  fieldValues.delete(nodeId);
}

export function registerWorkerHandler(
  workerId: number,
  handler: (data: string) => void,
): void {
  workerHandlers.set(workerId, handler);
}

export function unregisterWorkerHandler(workerId: number): void {
  workerHandlers.delete(workerId);
}

/** Registers a handler for a non-node event type (see FjsEvent on the Dart
 * side). Used by the router to receive navigator mount/pop callbacks. */
export function registerSystemHandler(
  type: number,
  handler: (id: number, payload?: string) => void,
): void {
  systemHandlers.set(type, handler);
}

/** Installs the global event dispatcher the native layer calls. */
export function installEventDispatcher(): void {
  globalThis.__fjsDispatchEvent =
    (nodeId: number, eventType: number, payload: string | null) => {
      if (eventType === 9) {
        // worker -> main message (nodeId is the worker handle)
        workerHandlers.get(nodeId)?.(payload ?? '');
        return;
      }
      const system = systemHandlers.get(eventType);
      if (system) {
        // nodeId addresses the subsystem (e.g. a navigator page key)
        system(nodeId, payload ?? undefined);
        return;
      }
      // Recorded whether or not the page listens: a <form> reads this, and
      // an unbound control has no handler of its own.
      if (eventType === 3 || eventType === 5) {
        fieldValues.set(nodeId, payload ?? '');
      }
      const handler = eventHandlers.get(handlerKey(nodeId, eventType));
      if (!handler) return;
      if (isTouchEvent(eventType)) {
        const event = decodeTouchEvent(eventType, payload);
        if (event) handler(event);
        return;
      }
      handler(payload ?? undefined);
    };
}

export interface Element {
  readonly id: number;
  readonly tag: string;
  appendChild(child: Element): Element;
  removeChild(child: Element): Element;
  setText(text: string): Element;
  setProps(props: Record<string, unknown>): Element;
}

export function create(tag: string): Element {
  const id = nextId++;
  getWriter().create(id, tag);
  scheduleFlush();
  return makeElement(id, tag);
}

function makeElement(id: number, tag: string): Element {
  const el: Element = {
    id,
    tag,
    appendChild(child) {
      insert(el, child);
      return child;
    },
    removeChild(child) {
      getWriter().removeChild(id, child.id);
      getWriter().remove(child.id);
      forgetHandlers(child.id);
      scheduleFlush();
      return child;
    },
    setText(text) {
      getWriter().setText(id, text);
      scheduleFlush();
      return el;
    },
    setProps(props) {
      setProps(el, props);
      return el;
    },
  };
  return el;
}

/** Extracts handler props (functions) into the registry and forwards the
 * rest — plus `on*: true` markers — to the native mirror tree.
 *
 * Handlers never cross the bridge; the native side only learns that one
 * EXISTS. So swapping the closure costs nothing there and must not cost an
 * op — which matters because it is the common case, not an edge case: a
 * template's `@tap="() => open(item)"` compiles to a fresh closure on every
 * render, so Vue sees the prop as changed and calls patchProp for every row
 * of a list on every re-render. Emitting a marker there wrote one redundant
 * SetProps per row, each landing as a jsonDecode and a props-map copy on the
 * Flutter side for a value that was already `true`. (Vue's own DOM renderer
 * solves the same problem with an invoker.) Only a change in PRESENCE is
 * worth telling the peer about. */
export function setProps(el: Element, props: Record<string, unknown>): void {
  const clean: Record<string, unknown> = {};
  let changed = false;
  for (const [key, value] of Object.entries(props)) {
    if (typeof value === 'function' && key.startsWith(EVENT_PREFIX)) {
      const type = EventType[key];
      if (type !== undefined) {
        const registryKey = handlerKey(el.id, type);
        const had = eventHandlers.has(registryKey);
        eventHandlers.set(registryKey, value as (payload?: EventPayload) => void);
        if (!had) {
          clean[CANONICAL_EVENT_PROP[key] ?? key] = true;
          changed = true;
        }
      } else {
        // Constitution V: a handler nobody listens for is a bug, not a
        // no-op. `@scrolltolower` was dead on Flutter for exactly this
        // reason — the template's all-lower spelling was missing from
        // EventType and the prop was dropped without a word.
        warnOnce(
          `unknown-handler:${key}`,
          `<${el.tag}> got a handler prop "${key}" that fjs does not know; ` +
            'it will never fire. Check the event name against EventType ' +
            '(packages/fjs-runtime/src/ui/element.ts).',
        );
      }
    } else if (value === null && key.startsWith(EVENT_PREFIX) && EventType[key] !== undefined) {
      // detach: drop the JS handler and clear the native marker
      const registryKey = handlerKey(el.id, EventType[key]);
      if (eventHandlers.delete(registryKey)) {
        clean[CANONICAL_EVENT_PROP[key] ?? key] = false;
        changed = true;
      }
    } else {
      recordField(el.id, key, value);
      clean[key] = value;
      changed = true;
    }
  }
  if (!changed) return; // nothing the peer can observe
  getWriter().setProps(el.id, clean);
  scheduleFlush();
}

/** Style-only fast path used by the style engine: no handler extraction
 * (a computed style never holds functions) and the serialized form is
 * shared between elements that resolve to the same style object. */
export function setStyle(
  el: Element,
  style: Record<string, unknown>,
  activeStyle?: Record<string, unknown> | null,
): void {
  getWriter().setStyle(el.id, style, activeStyle);
  scheduleFlush();
}

export function setText(el: Element, text: string): void {
  el.setText(text);
}

export function insert(parent: Element, child: Element, index?: number): void {
  getWriter().insert(parent.id, child.id, index ?? 0x7fffffff);
  scheduleFlush();
}

export function remove(el: Element): void {
  getWriter().remove(el.id);
  forgetHandlers(el.id);
  scheduleFlush();
}

/** Immediate flush — most apps rely on the microtask auto-flush instead. */
export function flush(): void {
  flushNow();
}

/** Creates the app root. parentId 0 = the host's implicit root container. */
export function createRoot(tag = 'view'): Element {
  const root = create(tag);
  getWriter().insert(0, root.id, 0);
  scheduleFlush();
  return root;
}

/** h() — hyperscript sugar: h('text', {style:...}, 'hello').
 * Children may be passed as an array too: h('view', props, [a, b]). */
export function h(
  tag: string,
  props?: Record<string, unknown>,
  ...children: Array<Element | string | number | Array<Element | string | number>>
): Element {
  const el = create(tag);
  if (props) setProps(el, props);
  const flat = children.flat(Infinity) as Array<Element | string | number>;
  for (const child of flat) {
    if (typeof child === 'string' || typeof child === 'number') {
      if (tag === 'text') {
        // keep text content on the text node itself so setText updates flow
        el.setText(String(child));
      } else {
        const textNode = create('text');
        textNode.setText(String(child));
        insert(el, textNode);
      }
    } else if (child && typeof (child as Element).id === 'number') {
      insert(el, child);
    }
  }
  return el;
}

// install dispatcher eagerly on module load
installEventDispatcher();
