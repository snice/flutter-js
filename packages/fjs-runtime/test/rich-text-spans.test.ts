// specs/035: flattening a paragraph's nested spans into `richSpans` runs.
// The hosts only read the result (widgets/text.dart, web/components/basic.ts),
// so the merge rules live — and are pinned — here.
import { describe, expect, it } from 'vitest';
import type { RenderChild } from '../src/rich-text/layout';
import { flattenSpans, isRichSpans, mergeSpanStyle } from '../src/rich-text/spans';

const span = (style: Record<string, unknown> | undefined, ...children: RenderChild[]): RenderChild => ({
  tag: 'text',
  ...(style ? { style } : {}),
  children,
});

describe('flattenSpans', () => {
  it('keeps bare strings bare and styled runs as {t, s}', () => {
    expect(flattenSpans(['a', span({ fontWeight: 'bold' }, 'b'), 'c'])).toEqual([
      'a',
      { t: 'b', s: { fontWeight: 'bold' } },
      'c',
    ]);
  });

  it('merges nested styles, the inner declaration winning', () => {
    expect(
      flattenSpans([
        span({ fontWeight: 'bold', color: '#111' }, 'x', span({ fontStyle: 'italic', color: '#222' }, 'y')),
      ]),
    ).toEqual([
      { t: 'x', s: { fontWeight: 'bold', color: '#111' } },
      { t: 'y', s: { fontWeight: 'bold', color: '#222', fontStyle: 'italic' } },
    ]);
  });

  it('adds text-decoration lines up instead of replacing them', () => {
    const [, struck] = flattenSpans([
      span({ textDecoration: 'underline' }, 'a', span({ textDecoration: 'line-through' }, 'b')),
    ])!;
    expect(struck).toEqual({ t: 'b', s: { textDecoration: 'underline line-through' } });
    // an inner `none` cannot remove the line an ancestor draws
    expect(mergeSpanStyle({ textDecoration: 'underline' }, { textDecoration: 'none' })).toEqual({
      textDecoration: 'underline',
    });
  });

  it('keeps sub / sup as runs with their vertical-align', () => {
    expect(flattenSpans(['H', span({ fontSize: 11.62, verticalAlign: 'sub' }, '2'), 'O'])).toEqual([
      'H',
      { t: '2', s: { fontSize: 11.62, verticalAlign: 'sub' } },
      'O',
    ]);
  });

  it('joins neighbours that look the same and drops empty strings', () => {
    expect(flattenSpans(['a', '', span(undefined, 'b'), span({}, 'c')])).toEqual(['abc']);
    expect(
      flattenSpans([span({ fontWeight: 'bold' }, 'x'), span({ fontWeight: 'bold' }, 'y')]),
    ).toEqual([{ t: 'xy', s: { fontWeight: 'bold' } }]);
  });

  it('gives up (null) on a class or an image anywhere inside', () => {
    expect(flattenSpans(['a', { tag: 'text', class: 'hl', children: ['b'] }])).toBeNull();
    expect(flattenSpans([span({ fontWeight: 'bold' }, { tag: 'text', class: 'deep', children: ['b'] })])).toBeNull();
    expect(flattenSpans(['a', { tag: 'image', props: { src: 'x' } }])).toBeNull();
  });
});

describe('isRichSpans', () => {
  it('accepts strings and {t, s}', () => {
    expect(isRichSpans([])).toBe(true);
    expect(isRichSpans(['a', { t: 'b', s: { color: 'red' } }])).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isRichSpans('a')).toBe(false);
    expect(isRichSpans([{ t: 'b' }])).toBe(false);
    expect(isRichSpans([{ t: 1, s: {} }])).toBe(false);
    expect(isRichSpans([null])).toBe(false);
  });
});
