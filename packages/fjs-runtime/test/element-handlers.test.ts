// Which handler prop names actually reach the native side.
//
// A template writes `@scrolltolower`, and Vue turns that into the prop
// `onScrolltolower` — all lower case. That spelling was missing from
// EventType, so on the Flutter path the handler was dropped without a
// word and the event never fired on device (the web adapter, which never
// goes through this layer, worked). Both halves of that failure are
// asserted here: the name resolves, and an unknown one is loud.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { create, setProps, installEventDispatcher } from '../src/ui/element';
import { getWriter, setOpSink } from '../src/host';
import { patchProp } from '../src/vue/renderer';

(globalThis as { __fjsHost?: { uiOpsVersion: number } }).__fjsHost = {
  uiOpsVersion: 2,
};

type Dispatch = (id: number, type: number, payload: string | null) => void;
const dispatchEvent = () =>
  (globalThis as { __fjsDispatchEvent?: Dispatch }).__fjsDispatchEvent!;

beforeEach(() => {
  setOpSink(() => {});
  installEventDispatcher();
});

/** The props a setProps call actually sends to the peer — the frame is
 * binary, so the writer is watched instead of decoded. */
function sentProps(fn: () => void): Record<string, unknown> {
  const writer = getWriter();
  const spy = vi
    .spyOn(writer, 'setProps')
    .mockImplementation(() => {});
  try {
    fn();
    return spy.mock.calls.length
      ? (spy.mock.calls[spy.mock.calls.length - 1][1] as Record<string, unknown>)
      : {};
  } finally {
    spy.mockRestore();
  }
}

const SCROLL_TO_UPPER = 24;
const SCROLL_TO_LOWER = 25;

describe('handler prop names', () => {
  it('accepts the spelling a template produces, under one canonical name',
    (): void => {
      const el = create('scroll-view');
      const seen: string[] = [];
      const props = sentProps(() =>
        setProps(el, {
          onScrolltolower: () => seen.push('lower'),
          onScrolltoupper: () => seen.push('upper'),
        }),
      );
      // the prop the Dart side looks for is the all-lower one
      expect(props.onScrolltolower).toBe(true);
      expect(props.onScrolltoupper).toBe(true);

      dispatchEvent()(el.id, SCROLL_TO_LOWER, null);
      dispatchEvent()(el.id, SCROLL_TO_UPPER, null);
      expect(seen).toEqual(['lower', 'upper']);
    });

  it('routes the camelCase alias to the same canonical prop and event', () => {
    const el = create('scroll-view');
    const seen: string[] = [];
    const props = sentProps(() =>
      setProps(el, { onScrollToLower: () => seen.push('lower') }),
    );
    expect(props.onScrolltolower).toBe(true);
    expect(props.onScrollToLower).toBeUndefined();

    dispatchEvent()(el.id, SCROLL_TO_LOWER, null);
    expect(seen).toEqual(['lower']);
  });

  it('sends a swiper\'s @change as the page event, not the value one', () => {
    // The web adapter emits `change` from the swiper as well, so a template
    // that works there has to work here: without the tag-aware alias the
    // handler lands under onValueChanged (5) while the swiper dispatches
    // pageChanged (6), and nothing ever calls it.
    const swiper = create('swiper');
    const swiperProps = sentProps(() =>
      patchProp(swiper, 'onChange', null, () => {}),
    );
    expect(swiperProps.onPageChanged).toBe(true);

    // ...and a control's @change still means the value changed
    const box = create('checkbox');
    const boxProps = sentProps(() => patchProp(box, 'onChange', null, () => {}));
    expect(boxProps.onValueChanged).toBe(true);
  });

  it('warns instead of silently dropping a handler it does not know', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = create('scroll-view');
    setProps(el, { onScrollToNowhere: () => {} });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('onScrollToNowhere');
    warn.mockRestore();
  });
});
