// @vitest-environment happy-dom
// The web half of specs/012-textarea: what the multiline props do to the
// DOM. The Flutter twin is flutter_fjs/test/textarea_test.dart, and the
// component that sits above both is covered by textarea-component.test.ts.
//
// Line COUNTS are not asserted here: happy-dom does not lay text out, so
// scrollHeight is always 0. That check is a device/browser one (spec §6.6).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref, type Component } from 'vue';
import { FjsInput } from '../src/web/components/form';

function mount(props: Record<string, unknown>) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  createApp({ render: () => h(FjsInput, props) } as Component).mount(host);
  return host;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('auto-height', () => {
  it('asks for three rows when it is off', async () => {
    const host = mount({ multiline: true });
    await nextTick();
    const area = host.querySelector('textarea') as HTMLTextAreaElement;
    // "three lines", not a pixel height: it follows the font size, the same
    // way maxLines: 3 does on Flutter
    expect(area.getAttribute('rows')).toBe('3');
    expect(area.className).not.toContain('auto-height');
  });

  it('drops rows and takes the growing class when it is on', async () => {
    const host = mount({ multiline: true, autoHeight: true });
    await nextTick();
    const area = host.querySelector('textarea') as HTMLTextAreaElement;
    expect(area.getAttribute('rows')).toBeNull();
    expect(area.className).toContain('fjs-input--auto-height');
  });

  it('gives the height back to CSS when it is switched off', async () => {
    // Caught in the browser: the box kept the pixel height auto-height had
    // written, so switching it off left the field at whatever size it had
    // grown to instead of the 90px the page's class asks for.
    const auto = ref(true);
    const host = document.createElement('div');
    document.body.appendChild(host);
    createApp({
      render: () => h(FjsInput, { multiline: true, autoHeight: auto.value }),
    } as Component).mount(host);
    await nextTick();
    const area = host.querySelector('textarea') as HTMLTextAreaElement;
    area.value = 'one\ntwo\nthree\nfour';
    area.dispatchEvent(new Event('input'));
    expect(area.style.height).not.toBe('');

    auto.value = false;
    await nextTick();
    await nextTick();
    expect(area.style.height).toBe('');
  });

  it('leaves a single-line input alone', async () => {
    const host = mount({});
    await nextTick();
    expect(host.querySelector('textarea')).toBeNull();
    expect(host.querySelector('input')?.getAttribute('rows')).toBeNull();
  });
});

describe('confirm-type', () => {
  it('return means the Enter key is a newline and no confirm', async () => {
    const submits: string[] = [];
    const host = mount({
      multiline: true,
      confirmType: 'return',
      onSubmit: (v: string) => submits.push(v),
    });
    await nextTick();
    const area = host.querySelector('textarea') as HTMLTextAreaElement;
    expect(area.getAttribute('enterkeyhint')).toBeNull();
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      cancelable: true,
    });
    area.dispatchEvent(event);
    expect(submits).toEqual([]);
    expect(event.defaultPrevented).toBe(false); // the newline goes in
  });

  it('any other value reports @confirm and swallows the newline', async () => {
    const submits: string[] = [];
    const host = mount({
      multiline: true,
      confirmType: 'send',
      onSubmit: (v: string) => submits.push(v),
    });
    await nextTick();
    const area = host.querySelector('textarea') as HTMLTextAreaElement;
    expect(area.getAttribute('enterkeyhint')).toBe('send');
    area.value = 'hello';
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      cancelable: true,
    });
    area.dispatchEvent(event);
    expect(submits).toEqual(['hello']);
    expect(event.defaultPrevented).toBe(true);
  });

  it('a single-line input still submits on Enter', async () => {
    const submits: string[] = [];
    const host = mount({ onSubmit: (v: string) => submits.push(v) });
    await nextTick();
    const input = host.querySelector('input') as HTMLInputElement;
    input.value = 'x';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(submits).toEqual(['x']);
  });
});

describe('focus', () => {
  it('takes focus on mount for auto-focus', async () => {
    const host = mount({ multiline: true, autoFocus: true });
    await nextTick();
    expect(document.activeElement).toBe(host.querySelector('textarea'));
  });

  it('moves only when the prop changes, so a tap-away sticks', async () => {
    const focus = ref(false);
    const host = document.createElement('div');
    document.body.appendChild(host);
    createApp({
      render: () => h(FjsInput, { multiline: true, focus: focus.value }),
    } as Component).mount(host);
    await nextTick();
    const area = host.querySelector('textarea') as HTMLTextAreaElement;
    expect(document.activeElement).not.toBe(area);

    focus.value = true;
    await nextTick();
    expect(document.activeElement).toBe(area);

    // the user taps elsewhere; the prop is still true and must not grab it
    area.blur();
    await nextTick();
    expect(document.activeElement).not.toBe(area);

    focus.value = false;
    await nextTick();
    focus.value = true;
    await nextTick();
    expect(document.activeElement).toBe(area);
  });
});

describe('placeholder-style', () => {
  it('feeds the four keys to ::placeholder as variables', async () => {
    const host = mount({
      multiline: true,
      placeholderStyle: 'color: #c0c0c0; font-size: 12px',
    });
    await nextTick();
    const area = host.querySelector('textarea') as HTMLTextAreaElement;
    expect(area.style.getPropertyValue('--fjs-placeholder-color')).toBe(
      '#c0c0c0',
    );
    expect(area.style.getPropertyValue('--fjs-placeholder-font-size')).toBe(
      '12px',
    );
  });

  it('does not clobber the page style', async () => {
    const host = mount({
      multiline: true,
      placeholderStyle: 'color: #c0c0c0',
      style: { height: '80px' },
    });
    await nextTick();
    const area = host.querySelector('textarea') as HTMLTextAreaElement;
    expect(area.style.height).toBe('80px');
    expect(area.style.getPropertyValue('--fjs-placeholder-color')).toBe(
      '#c0c0c0',
    );
  });
});

describe('linechange', () => {
  it('reports a measurement on input, in the shared payload shape', async () => {
    const lines: string[] = [];
    const host = mount({
      multiline: true,
      onLinechange: (payload: string) => lines.push(payload),
    });
    await nextTick();
    const area = host.querySelector('textarea') as HTMLTextAreaElement;
    area.value = 'hello';
    area.dispatchEvent(new Event('input'));
    expect(lines.length).toBeGreaterThan(0);
    const detail = JSON.parse(lines[lines.length - 1]) as Record<string, number>;
    expect(Object.keys(detail)).toEqual(['height', 'lineCount']);
    expect(detail.lineCount).toBeGreaterThanOrEqual(1);
  });

  it('says nothing for a single-line input', async () => {
    const lines: string[] = [];
    const host = mount({ onLinechange: (payload: string) => lines.push(payload) });
    await nextTick();
    const input = host.querySelector('input') as HTMLInputElement;
    input.value = 'hello';
    input.dispatchEvent(new Event('input'));
    expect(lines).toEqual([]);
  });
});
