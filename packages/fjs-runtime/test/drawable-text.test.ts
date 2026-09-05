import { describe, expect, it } from 'vitest';
import { drawableText } from '../src/ui/drawable-text';
import { OpWriter, UiOp } from '../src/ui/ops';

describe('drawableText', () => {
  it('drops the NUL ECharts puts in unnamed series ids', () => {
    expect(drawableText('series\u00000: 735')).toBe('series0: 735');
  });

  it('keeps tab and newline, which both platforms lay out', () => {
    expect(drawableText('a\tb\nc')).toBe('a\tb\nc');
  });
});

describe('OpWriter.setText', () => {
  it('writes the drawable form, so overlay text matches fillText', () => {
    const w = new OpWriter();
    w.setText(1, 'series\u00000：484');
    const bytes = w.toUint8Array();
    expect(bytes[0]).toBe(UiOp.SetText);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const len = view.getUint32(5, true);
    const text = new TextDecoder().decode(bytes.subarray(9, 9 + len));
    expect(text).toBe('series0：484');
  });
});
