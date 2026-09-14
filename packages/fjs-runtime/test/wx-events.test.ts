// spec 048: the mp event adapter hands pages the same string payloads the
// other two ends emit (docs/ui-api.md) — pages JSON.parse / Number() them.
import { describe, expect, it } from 'vitest';
import { adaptEvent } from '../src/wx/events';

const ev = (detail: Record<string, unknown>) => ({ detail });

describe('adaptEvent string payloads', () => {
  it('picker-view change: index array as JSON text', () => {
    expect(adaptEvent('picker-view', 'change', ev({ value: [6, 8] })).payload).toBe('[6,8]');
  });

  it('picker: selector index as a string, multiSelector as JSON text', () => {
    expect(adaptEvent('picker', 'change', ev({ value: '2' })).payload).toBe('2');
    expect(adaptEvent('picker', 'change', ev({ value: 3 })).payload).toBe('3');
    expect(adaptEvent('picker', 'change', ev({ value: '2026-09-14' })).payload).toBe('2026-09-14');
    expect(adaptEvent('picker', 'change', ev({ value: [1, 0, 3] })).payload).toBe('[1,0,3]');
    expect(adaptEvent('picker', 'columnchange', ev({ column: 0, value: 2 })).payload).toBe('{"column":0,"value":2}');
  });

  it('form submit: {name: value} as JSON text, in the order wx reports', () => {
    const payload = adaptEvent('form', 'submit', ev({ value: { nickname: '小明', agree: false, langs: ['dart'] } })).payload;
    expect(payload).toBe('{"nickname":"小明","agree":false,"langs":["dart"]}');
    expect(adaptEvent('form', 'reset', ev({})).payload).toBeUndefined();
  });
});
