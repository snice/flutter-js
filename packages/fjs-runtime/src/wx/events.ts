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

export interface NormalizedEvent {
  /** fjs-style payload. `undefined` = "no payload" (most taps). */
  payload: unknown;
  /** The raw wx event, for handlers that genuinely need positions etc. */
  raw: unknown;
}

type Adapter = (e: WxEvent) => unknown;

interface WxEvent {
  detail?: Record<string, unknown>;
  currentTarget?: Record<string, unknown>;
  touches?: Array<{ clientX?: number; clientY?: number }>;
  changedTouches?: Array<{ clientX?: number; clientY?: number }>;
}

const detail = (e: WxEvent): Record<string, unknown> => e.detail ?? {};
const detailValue = (e: WxEvent): unknown => detail(e).value;

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
  'checkbox-group': { change: (e) => detailValue(e) },
  radio: { change: (e) => detailValue(e) },
  'radio-group': { change: (e) => detailValue(e) },
  slider: {
    change: (e) => detailValue(e),
    input: (e) => detailValue(e),
    changing: (e) => detailValue(e),
  },
  picker: {
    change: (e) => detailValue(e),
    // wx e.type collapses the kebab: bindcolumnchange fires type 'columnchange'
    columnchange: (e) => detail(e),
    cancel: () => undefined,
  },
  'picker-view': {
    change: (e) => detailValue(e),
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
    submit: (e) => detailValue(e),
    reset: () => undefined,
  },
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
  image: {
    load: (e) => detail(e),
    error: (e) => detail(e)?.errMsg,
  },
  canvas: {
    // fjs canvas events carry positions in surface coords
    tap: touchPayload,
  },
};

const FALLBACK: Record<string, Adapter> = {
  tap: () => undefined,
  'long-press': touchPayload,
  longpress: touchPayload,
  touchstart: touchPayload,
  touchmove: touchPayload,
  touchend: touchPayload,
  touchcancel: touchPayload,
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
