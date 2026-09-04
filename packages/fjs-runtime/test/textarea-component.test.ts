// @vitest-environment happy-dom
// The textarea component's own job: defaults, prop normalization, the
// warnings, and the @linechange gate. What it renders INTO is a stub here —
// the real targets (the `input` element on Flutter, the web adapter's
// FjsInput) are covered by their own tests.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref, type Component } from 'vue';
import {
  createFjsTextarea,
  resetTextareaWarnOnce,
} from '../src/components/textarea';
import { TEXTAREA_DEFAULT_MAXLENGTH } from '../src/textarea/props';

/** Records what the component hands its render target. */
let seen: Record<string, unknown> = {};

const Target = defineComponent({
  name: 'Target',
  inheritAttrs: false,
  setup(_props, { attrs }) {
    seen = attrs;
    return () => h('div');
  },
});

const Textarea = createFjsTextarea(Target);

function mount(props: Record<string, unknown> = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  createApp({ render: () => h(Textarea, props) } as Component).mount(host);
  return host;
}

beforeEach(() => {
  seen = {};
  resetTextareaWarnOnce();
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('defaults', () => {
  it('is always multiline and caps at 140 characters', async () => {
    mount();
    await nextTick();
    expect(seen.multiline).toBe(true);
    expect(seen.maxlength).toBe(TEXTAREA_DEFAULT_MAXLENGTH);
  });

  it('still takes -1 for no limit', async () => {
    mount({ maxlength: -1 });
    await nextTick();
    expect(seen.maxlength).toBe(-1);
  });

  it('defaults confirm-type to return and auto-height to off', async () => {
    mount();
    await nextTick();
    expect(seen.confirmType).toBe('return');
    expect(seen.autoHeight).toBe(false);
  });

  it('passes class and style through to the target', async () => {
    mount({ class: 'note', style: { height: '80px' } });
    await nextTick();
    expect(seen.class).toBe('note');
    expect(seen.style).toEqual({ height: '80px' });
  });
});

describe('warnings (constitution V)', () => {
  it('warns once for an unknown confirm-type and falls back to return', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mount({ confirmType: 'shout' });
    await nextTick();
    expect(seen.confirmType).toBe('return');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('confirm-type="shout"');
  });

  it('warns when focus and auto-focus are both set, and focus wins', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mount({ focus: true, autoFocus: true });
    await nextTick();
    expect(seen.focus).toBe(true);
    expect(seen.autoFocus).toBe(false);
    expect(warn.mock.calls[0][0]).toContain('auto-focus');
  });

  it('warns for a placeholder-style key that cannot reach both platforms', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mount({ placeholderStyle: 'color: #ccc; text-shadow: 0 0 2px red' });
    await nextTick();
    // the string is passed through whole — both hosts parse it themselves
    expect(seen.placeholderStyle).toBe('color: #ccc; text-shadow: 0 0 2px red');
    expect(warn.mock.calls[0][0]).toContain('text-shadow');
  });

  it('warns for the keyboard knobs it does not implement', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mount({ cursorSpacing: 20, holdKeyboard: true });
    await nextTick();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.map((c) => String(c[0])).join(' ')).toContain(
      'cursorSpacing',
    );
  });
});

describe('events', () => {
  it('reports input twice under both names, like the input tag', async () => {
    const input: string[] = [];
    const changed: string[] = [];
    mount({
      onInput: (v: string) => input.push(v),
      onTextChanged: (v: string) => changed.push(v),
    });
    await nextTick();
    (seen.onTextChanged as (v: string) => void)('hi');
    expect(input).toEqual(['hi']);
    expect(changed).toEqual(['hi']);
  });

  it('turns the host submit into @confirm', async () => {
    const confirmed: string[] = [];
    mount({ onConfirm: (v: string) => confirmed.push(v) });
    await nextTick();
    (seen.onSubmit as (v: string) => void)('done');
    expect(confirmed).toEqual(['done']);
  });

  it('drops the first line report and emits only on a change', async () => {
    const lines: string[] = [];
    mount({ onLinechange: (v: string) => lines.push(v) });
    await nextTick();
    const report = seen.onLinechange as (payload: string) => void;
    report('{"height":20,"lineCount":1}'); // priming
    expect(lines).toEqual([]);
    report('{"height":20,"lineCount":1}'); // same count
    expect(lines).toEqual([]);
    report('{"height":40,"lineCount":2}');
    expect(lines).toEqual(['{"height":40,"lineCount":2}']);
  });

  it('ignores a malformed line report instead of throwing', async () => {
    const lines: string[] = [];
    mount({ onLinechange: (v: string) => lines.push(v) });
    await nextTick();
    const report = seen.onLinechange as (payload: string) => void;
    expect(() => report('not json')).not.toThrow();
    expect(lines).toEqual([]);
  });
});

describe('value', () => {
  it('only sends value when the page bound one', async () => {
    mount();
    await nextTick();
    expect('value' in seen).toBe(false);
  });

  it('follows a bound value', async () => {
    const value = ref('a');
    const host = document.createElement('div');
    document.body.appendChild(host);
    createApp({
      render: () => h(Textarea, { value: value.value }),
    } as Component).mount(host);
    await nextTick();
    expect(seen.value).toBe('a');
    value.value = 'b';
    await nextTick();
    expect(seen.value).toBe('b');
  });
});
