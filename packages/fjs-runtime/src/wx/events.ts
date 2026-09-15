// Event payload adapter: wx event object -> fjs event semantics.
//
// Pages are written once against fjs's event contract ("the handler gets
// the payload", strings where the host provides strings — constitution IV).
// On wx the handler instead receives the platform's event object whose
// value hides in `e.detail.value` and whose shape differs per tag. The
// compiler stamps each event binding with `data-tag` / `data-ev`, and
// instance.ts routes the raw event through adaptEvent() before the handler
// sees it.
//
// This table is the mp half of the same account the web adapter keeps in
// web/events; keep both listed together when adding a tag×event pair.

import { encodeImageError, encodeImageLoad } from '../image/events';

export interface NormalizedEvent {
  /** fjs-style payload. `undefined` = "no payload" (most taps). */
  payload: unknown;
  /** The raw wx event, for handlers that genuinely need positions etc. */
  raw: unknown;
}

type Adapter = (e: WxEvent) => unknown;

interface WxTouch {
  identifier?: number;
  clientX?: number;
  clientY?: number;
  pageX?: number;
  pageY?: number;
  /** canvas touches: position relative to the canvas node */
  x?: number;
  y?: number;
}

interface WxEvent {
  type?: string;
  timeStamp?: number;
  detail?: Record<string, unknown>;
  currentTarget?: Record<string, unknown>;
  target?: Record<string, unknown>;
  touches?: WxTouch[];
  changedTouches?: WxTouch[];
}

const detail = (e: WxEvent): Record<string, unknown> => e.detail ?? {};

const stickyStickAdapter = (e: WxEvent): string =>
  JSON.stringify({ isStickOnTop: !!detail(e).isStickOnTop });
const detailValue = (e: WxEvent): unknown => detail(e).value;

/** The other two ends hand over strings (constitution IV, docs/ui-api.md):
 * an index array travels as its JSON text (`"[1,0,3]"`), a single index or a
 * date as the string wx already gives. Pages `JSON.parse` / `Number()` it, so
 * the raw array wx reports would throw there. */
const valueString = (e: WxEvent): string => {
  const v = detailValue(e);
  return Array.isArray(v) ? JSON.stringify(v.map(Number)) : String(v ?? '');
};

/** touch positions as fjs touch events carry them (client coords). */
function touchPayload(e: WxEvent): unknown {
  const t = e.changedTouches?.[0] ?? e.touches?.[0];
  return t ? { x: t.clientX, y: t.clientY } : undefined;
}

/** tag × event adapters. Key: `${tag}:${event}`; the `*` table is the
 * fallback per event name for tags without a specific entry. */
const BY_TAG: Record<string, Record<string, Adapter>> = {
  switch: { change: (e) => (detailValue(e) ? '1' : '0') },
  checkbox: { change: (e) => detailValue(e) },
  // runtime components (components/fjs-*) trigger { value } like the natives
  'fjs-checkbox': { change: (e) => detailValue(e) },
  'fjs-radio': { change: (e) => detailValue(e) },
  'fjs-checkbox-group': { change: (e) => detailValue(e) },
  'fjs-radio-group': { change: (e) => detailValue(e) },
  'checkbox-group': { change: (e) => detailValue(e) },
  radio: { change: (e) => detailValue(e) },
  'radio-group': { change: (e) => detailValue(e) },
  slider: {
    change: (e) => detailValue(e),
    input: (e) => detailValue(e),
    changing: (e) => detailValue(e),
  },
  picker: {
    change: valueString,
    // wx e.type collapses the kebab: bindcolumnchange fires type 'columnchange'
    columnchange: (e) =>
      JSON.stringify({ column: Number(detail(e).column), value: Number(detail(e).value) }),
    cancel: () => undefined,
  },
  'picker-view': {
    change: valueString,
    pickstart: () => undefined,
    pickend: () => undefined,
  },
  'picker-view-column': { change: (e) => detailValue(e) },
  swiper: { change: (e) => detail(e).current, transition: (e) => detail(e).current },
  input: {
    input: (e) => detailValue(e),
    focus: (e) => detailValue(e),
    blur: (e) => detailValue(e),
    confirm: (e) => detailValue(e),
  },
  textarea: {
    input: (e) => detailValue(e),
    focus: (e) => detailValue(e),
    blur: (e) => detailValue(e),
    confirm: (e) => detailValue(e),
    linechange: (e) => detail(e),
  },
  form: {
    // `{name: value}` as JSON text, like components/form.ts on the other ends
    submit: (e) => JSON.stringify(detailValue(e) ?? {}),
    reset: () => undefined,
  },
  // sticky-header reports {isStickOnTop} in detail; the payload is the same
  // JSON string the web component and the Dart probe emit (specs/052). Two
  // keys: skyline's native tag passes through verbatim, the webview
  // renderer's custom component arrives under its mapped name (specs/053).
  'sticky-header': { stickontopchange: stickyStickAdapter },
  'fjs-sticky-header': { stickontopchange: stickyStickAdapter },
  'scroll-view': {
    scroll: (e) => {
      const d = detail(e);
      return {
        scrollTop: d.scrollTop,
        scrollLeft: d.scrollLeft,
        scrollHeight: d.scrollHeight,
        scrollWidth: d.scrollWidth,
        deltaX: d.deltaX,
        deltaY: d.deltaY,
      };
    },
    scrolltolower: () => undefined,
    scrolltoupper: () => undefined,
  },
  // same JSON strings the other two ends emit (image/events.ts)
  image: {
    load: (e) => encodeImageLoad(Number(detail(e).width) || 0, Number(detail(e).height) || 0),
    error: (e) => encodeImageError(detail(e).errMsg as string | undefined),
  },
  canvas: {
    // fjs canvas events carry positions in surface coords
    tap: touchPayload,
  },
};

/** touchstart/move/end/cancel -> the DOM-shaped FjsTouchEvent the other two
 * ends hand over (ui/touch.ts). The origin for offsetX/Y is the listening
 * node's page offset, which wx reports on currentTarget. There is no page
 * scroll of its own, so client/page/screen coordinates are the same number,
 * as on the other ends. targetTouches is approximated by touches: wx does
 * not say which fingers went down on this node. */
function touchEvent(e: WxEvent): unknown {
  const ct = e.currentTarget ?? {};
  const ox = Number(ct.offsetLeft) || 0;
  const oy = Number(ct.offsetTop) || 0;
  const make = (t: WxTouch) => {
    // a canvas reports node-relative x/y instead of client coordinates
    const local = t.clientX == null && t.pageX == null && t.x != null;
    const x = local ? (Number(t.x) || 0) + ox : Number(t.clientX ?? t.pageX) || 0;
    const y = local ? (Number(t.y) || 0) + oy : Number(t.clientY ?? t.pageY) || 0;
    return {
      identifier: Number(t.identifier) || 0,
      x,
      y,
      clientX: x,
      clientY: y,
      pageX: x,
      pageY: y,
      screenX: x,
      screenY: y,
      offsetX: x - ox,
      offsetY: y - oy,
    };
  };
  const touches = (e.touches ?? []).map(make);
  const target = { id: String(ct.id ?? '') };
  return {
    type: e.type,
    timeStamp: Number(e.timeStamp) || Date.now(),
    target,
    currentTarget: target,
    touches,
    targetTouches: touches,
    changedTouches: (e.changedTouches ?? []).map(make),
    preventDefault() {},
    stopPropagation() {},
  };
}

const FALLBACK: Record<string, Adapter> = {
  tap: () => undefined,
  'long-press': touchPayload,
  longpress: touchPayload,
  touchstart: touchEvent,
  touchmove: touchEvent,
  touchend: touchEvent,
  touchcancel: touchEvent,
  load: (e) => detail(e),
  error: (e) => detail(e)?.errMsg,
  // custom component events (fjs-modal, fjs-toast, app components) have no
  // fallback entry: adaptEvent's default already passes `e.detail` through,
  // which is exactly what triggerEvent sent.
};

export function adaptEvent(tag: string, event: string, e: WxEvent): NormalizedEvent {
  const fn = BY_TAG[tag]?.[event] ?? FALLBACK[event] ?? ((ev: WxEvent) => ev.detail);
  let payload: unknown;
  try {
    payload = fn(e);
  } catch (err) {
    console.error(`[fjs/wx] adaptEvent(${tag}:${event}) failed:`, err);
  }
  return { payload, raw: e };
}
