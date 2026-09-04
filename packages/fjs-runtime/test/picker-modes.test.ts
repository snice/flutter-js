// The value math behind <picker>. Everything here is a pure function, so
// the awkward cases (leap February, a range inside one month, a coarser
// `fields`) are cheap to pin down — no wheel, no renderer.
import { describe, expect, it } from 'vitest';
import {
  clampIndex,
  columnsFor,
  dateColumns,
  dateFromColumns,
  daysInMonth,
  flattenRange,
  reflow,
  timeColumns,
  timeFromColumns,
  valueFor,
} from '../src/components/picker-modes';

describe('range flattening', () => {
  it('reads the labels a range-key points at', () => {
    const range = [{ id: 1, name: '苹果' }, { id: 2, name: '香蕉' }];
    expect(flattenRange(range, 'name')).toEqual(['苹果', '香蕉']);
  });

  it('never renders [object Object] silently', () => {
    expect(flattenRange([{ a: 1 }])).toEqual(['{"a":1}']);
  });

  it('takes scalars as they are', () => {
    expect(flattenRange(['a', 2, true])).toEqual(['a', '2', 'true']);
  });
});

describe('index clamping', () => {
  it('takes the last item when the value overshoots', () => {
    expect(clampIndex(9, 3)).toBe(2);
  });

  it('floors a negative or broken value to 0', () => {
    expect(clampIndex(-1, 3)).toBe(0);
    expect(clampIndex(Number.NaN, 3)).toBe(0);
  });

  it('stays at 0 for an empty column', () => {
    expect(clampIndex(5, 0)).toBe(0);
  });
});

describe('date columns', () => {
  it('gives year / month / day inside the range', () => {
    const cols = dateColumns('2026-09-04', '2020-01-01', '2030-12-31');
    expect(cols).toHaveLength(3);
    expect(cols[0].items[cols[0].index]).toBe('2026');
    expect(cols[1].items[cols[1].index]).toBe('09');
    expect(cols[2].items[cols[2].index]).toBe('04');
  });

  it('knows February in a leap year', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2025, 2)).toBe(28);
    const cols = dateColumns('2024-02-10', '2024-01-01', '2024-12-31');
    expect(cols[2].items).toHaveLength(29);
  });

  it('crops the month and day lists at the boundary year', () => {
    const cols = dateColumns('2020-03-05', '2020-03-02', '2021-06-30');
    expect(cols[1].items[0]).toBe('03'); // no January / February in 2020
    expect(cols[2].items[0]).toBe('02'); // the range starts on the 2nd
  });

  it('handles a range that lives inside one month', () => {
    const cols = dateColumns('2026-09-10', '2026-09-05', '2026-09-15');
    expect(cols[0].items).toEqual(['2026']);
    expect(cols[1].items).toEqual(['09']);
    expect(cols[2].items).toEqual([
      '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15',
    ]);
  });

  it('drops the columns `fields` says are not there', () => {
    expect(dateColumns('2026-09-04', '2020-01-01', '2030-12-31', 'year'))
      .toHaveLength(1);
    expect(dateColumns('2026-09-04', '2020-01-01', '2030-12-31', 'month'))
      .toHaveLength(2);
  });

  it('clamps a value outside the range to the boundary', () => {
    const cols = dateColumns('2019-05-05', '2020-01-01', '2030-12-31');
    expect(dateFromColumns(cols)).toBe('2020-01-01');
  });

  it('falls back to today when the value is not a date', () => {
    const cols = dateColumns('nonsense', '1970-01-01', '2100-12-31');
    const today = new Date();
    expect(cols[0].items[cols[0].index]).toBe(String(today.getFullYear()));
  });

  it('never spells a day the month does not have', () => {
    // 31 selected, then the month moves to one with 30 days
    const cols = dateColumns('2026-01-31', '2020-01-01', '2030-12-31');
    cols[1].index = cols[1].items.indexOf('04');
    expect(dateFromColumns(cols)).toBe('2026-04-30');
  });

  it('reflows the day column after the month moves', () => {
    const cols = dateColumns('2024-01-31', '2020-01-01', '2030-12-31');
    cols[1].index = cols[1].items.indexOf('02');
    const next = reflow('date', cols, { start: '2020-01-01', end: '2030-12-31' });
    expect(next[2].items).toHaveLength(29); // 2024 is a leap year
    expect(dateFromColumns(next)).toBe('2024-02-29');
  });
});

describe('time columns', () => {
  it('gives hours and minutes inside the range', () => {
    const cols = timeColumns('09:30', '09:00', '21:00');
    expect(cols[0].items[0]).toBe('09');
    expect(cols[0].items.at(-1)).toBe('21');
    expect(timeFromColumns(cols)).toBe('09:30');
  });

  it('crops the minutes at the boundary hour', () => {
    const cols = timeColumns('09:05', '09:01', '21:00');
    expect(cols[1].items[0]).toBe('01');
  });

  it('clamps a value outside the range', () => {
    expect(timeFromColumns(timeColumns('06:00', '09:00', '21:00')))
      .toBe('09:00');
  });

  it('covers the whole day when no range is given', () => {
    const cols = timeColumns('00:00', undefined, undefined);
    expect(cols[0].items).toHaveLength(24);
    expect(cols[1].items).toHaveLength(60);
  });
});

describe('mode dispatch', () => {
  it('reports an unknown mode instead of rendering an empty wheel', () => {
    expect(columnsFor('nope', {})).toBeNull();
  });

  it('carries each mode payload as the string both platforms send', () => {
    expect(valueFor('selector', [{ items: ['a', 'b', 'c'], index: 2 }]))
      .toBe('2');
    expect(
      valueFor('multiSelector', [
        { items: ['a', 'b'], index: 1 },
        { items: ['x'], index: 0 },
        { items: ['p', 'q', 'r', 's'], index: 3 },
      ]),
    ).toBe('[1,0,3]');
    expect(valueFor('time', timeColumns('09:30', '00:00', '23:59')))
      .toBe('09:30');
    expect(valueFor('date', dateColumns('2026-09-04', '2020-01-01', '2030-12-31')))
      .toBe('2026-09-04');
  });

  it('leaves selector columns alone on reflow — linkage is the page job', () => {
    const cols = [
      { items: ['a', 'b'], index: 1 },
      { items: ['x', 'y'], index: 0 },
    ];
    expect(reflow('multiSelector', cols, {})).toBe(cols);
  });
});
