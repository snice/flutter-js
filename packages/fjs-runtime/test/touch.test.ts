// @vitest-environment happy-dom
// Touch events on both halves: the Flutter payload decoder, and the web
// adapter that has to produce exactly the same objects from pointer events.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h } from 'vue';
import { decodeTouchEvent, isTouchEvent, type FjsTouchEvent } from '../src/ui/touch';
import { FjsView } from '../src/web/components/basic';

describe('decodeTouchEvent', () => {
  it('expands the compact wire form into DOM-shaped lists', () => {
    const event = decodeTouchEvent(
      16,
      '{"ts":1234.5,"id":"card","touches":[[7,120.5,300]]}',
    )!;
    expect(event.type).toBe('touchmove');
    expect(event.timeStamp).toBe(1234.5);
    expect(event.target.id).toBe('card');
    expect(event.currentTarget).toBe(event.target);
    const touch = event.touches[0];
    expect(touch.identifier).toBe(7);
    expect([touch.clientX, touch.pageX, touch.screenX, touch.x]).toEqual([
      120.5, 120.5, 120.5, 120.5,
    ]);
    // with one finger down the three lists are the same, and the payload
    // says so by leaving two of them out
    expect(event.targetTouches).toBe(event.touches);
    expect(event.changedTouches).toBe(event.touches);
  });

  it('keeps the lists apart when they differ', () => {
    const event = decodeTouchEvent(
      17,
      '{"ts":1,"touches":[],"changed":[[2,10,20]]}',
    )!;
    expect(event.type).toBe('touchend');
    expect(event.touches).toEqual([]);
    expect(event.changedTouches).toHaveLength(1);
  });

  it('turns the node origin into DOM offsets', () => {
    // A canvas hit-tests against offsetX/offsetY, and page coordinates are
    // useless for that: the host sends the node's origin (`o`) precisely so
    // this side can subtract it.
    const event = decodeTouchEvent(15, JSON.stringify({
      ts: 1,
      o: [12, 100],
      touches: [[1, 30, 160]],
    }));
    expect(event?.touches[0].clientX).toBe(30);
    expect(event?.touches[0].offsetX).toBe(18);
    expect(event?.touches[0].offsetY).toBe(60);
  });

  it('falls back to client coordinates when the host sends no origin', () => {
    // an older host: wrong-but-bounded beats undefined
    const event = decodeTouchEvent(15, JSON.stringify({ ts: 1, touches: [[1, 30, 160]] }));
    expect(event?.touches[0].offsetX).toBe(30);
    expect(event?.touches[0].offsetY).toBe(160);
  });

  it('survives a malformed payload', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(decodeTouchEvent(15, '{not json')).toBeNull();
    expect(decodeTouchEvent(15, null)).toBeNull();
    expect(decodeTouchEvent(99, '{}')).toBeNull();
    warn.mockRestore();
  });

  it('knows which event ids are touches', () => {
    expect([15, 16, 17, 18].every(isTouchEvent)).toBe(true);
    expect(isTouchEvent(1)).toBe(false);
  });
});

function pointer(type: string, init: Partial<PointerEventInit> = {}): Event {
  // happy-dom has no PointerEvent constructor; the fields the adapter reads
  // are the ones set here
  const event = new Event(type, { bubbles: true });
  Object.assign(event, {
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    pointerType: 'touch',
    ...init,
  });
  return event;
}

function mountView(handlers: Record<string, unknown>) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const app = createApp({
    render: () => h(FjsView, { id: 'card', ...handlers }),
  });
  app.mount(root);
  const host = root.querySelector('view') as HTMLElement;
  // pointer capture is best-effort in the adapter; happy-dom has none
  (host as unknown as { setPointerCapture: () => void }).setPointerCapture =
    () => {};
  return host;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('web touch bindings', () => {
  it('turns pointer events into the same objects Flutter sends', () => {
    const seen: FjsTouchEvent[] = [];
    const record = (e: FjsTouchEvent) => seen.push(e);
    const host = mountView({
      onTouchstart: record,
      onTouchmove: record,
      onTouchend: record,
    });

    host.dispatchEvent(pointer('pointerdown', { clientX: 10, clientY: 20 }));
    host.dispatchEvent(pointer('pointermove', { clientX: 30, clientY: 50 }));
    host.dispatchEvent(pointer('pointerup', { clientX: 30, clientY: 50 }));

    expect(seen.map((e) => e.type)).toEqual([
      'touchstart',
      'touchmove',
      'touchend',
    ]);
    expect(seen[0].target.id).toBe('card');
    expect(seen[1].touches[0].clientX).toBe(30);
    expect(seen[1].targetTouches).toHaveLength(1);
    // the finger that left is only in changedTouches, as in the DOM
    expect(seen[2].touches).toHaveLength(0);
    expect(seen[2].changedTouches[0].identifier).toBe(1);
  });

  it('reports a cancelled pointer as touchcancel', () => {
    const seen: FjsTouchEvent[] = [];
    const host = mountView({
      onTouchstart: (e: FjsTouchEvent) => seen.push(e),
      onTouchcancel: (e: FjsTouchEvent) => seen.push(e),
    });
    host.dispatchEvent(pointer('pointerdown'));
    host.dispatchEvent(pointer('pointercancel'));
    expect(seen.map((e) => e.type)).toEqual(['touchstart', 'touchcancel']);
  });

  it('keeps routing moves and the release after the pointer leaves the element', () => {
    const seen: FjsTouchEvent[] = [];
    const host = mountView({
      onTouchstart: (e: FjsTouchEvent) => seen.push(e),
      onTouchmove: (e: FjsTouchEvent) => seen.push(e),
      onTouchend: (e: FjsTouchEvent) => seen.push(e),
    });

    host.dispatchEvent(pointer('pointerdown', { clientX: 10, clientY: 20 }));
    window.dispatchEvent(pointer('pointermove', { clientX: 30, clientY: 50 }));
    window.dispatchEvent(pointer('pointerup', { clientX: 40, clientY: 60 }));

    expect(seen.map((e) => e.type)).toEqual([
      'touchstart',
      'touchmove',
      'touchend',
    ]);
    expect(seen[1].target.id).toBe('card');
    expect(seen[1].touches[0].clientX).toBe(30);
    expect(seen[2].touches).toHaveLength(0);
    expect(seen[2].changedTouches[0].clientY).toBe(60);
  });

  it('does not bind the raw DOM touch attributes', () => {
    const host = mountView({ onTouchstart: () => {} });
    // the handler prop is consumed by the adapter: an actual DOM touchstart
    // must not reach it (its event object would be the wrong shape)
    expect(host.getAttribute('onTouchstart')).toBeNull();
  });

  it('leaves tags without touch handlers alone', () => {
    const tap = vi.fn();
    const host = mountView({ onTap: tap });
    host.dispatchEvent(pointer('pointerdown'));
    host.dispatchEvent(new Event('click', { bubbles: true }));
    expect(tap).toHaveBeenCalledOnce();
  });
});
