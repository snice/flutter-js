// Element API — the HTML-like UI layer. JS apps build node trees with
// h()/element functions; ops are batched per microtask and flushed to the
// native host in one frame (mirrors React Native's batched shadow commits).
import { getWriter, scheduleFlush, flushNow } from '../host';

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
};

let nextId = 1;
const eventHandlers = new Map<string, (payload?: string) => void>();
const workerHandlers = new Map<number, (data: string) => void>();
/** Events that address a subsystem instead of a node (worker messages,
 * navigator callbacks). `id` is that subsystem's own handle. */
const systemHandlers = new Map<number, (id: number, payload?: string) => void>();

export function handlerKey(nodeId: number, type: number): string {
  return `${nodeId}:${type}`;
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
      const handler = eventHandlers.get(handlerKey(nodeId, eventType));
      if (handler) handler(payload ?? undefined);
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
 * rest — plus `on*: true` markers — to the native mirror tree. */
export function setProps(el: Element, props: Record<string, unknown>): void {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (typeof value === 'function' && key.startsWith(EVENT_PREFIX)) {
      const type = EventType[key];
      if (type !== undefined) {
        eventHandlers.set(handlerKey(el.id, type), value as (payload?: string) => void);
        clean[key] = true;
      }
      // unknown handler names are ignored silently
    } else if (value === null && key.startsWith(EVENT_PREFIX) && EventType[key] !== undefined) {
      // detach: drop the JS handler and clear the native marker
      eventHandlers.delete(handlerKey(el.id, EventType[key]));
      clean[key] = false;
    } else {
      clean[key] = value;
    }
  }
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
  eventHandlers.forEach((_, key) => {
    if (key.startsWith(`${el.id}:`)) eventHandlers.delete(key);
  });
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
