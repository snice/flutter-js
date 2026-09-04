// The value math behind `<picker>`'s four modes — columns in, columns out,
// no Vue and no DOM.
//
// It lives on its own because it is where the bugs are: leap Februaries,
// a `start`/`end` inside one month, `fields="month"` meaning the day column
// must not exist at all. Testing that through a rendered wheel would be
// slow and indirect; here it is a table of pure functions
// (test/picker-modes.test.ts).
//
// Everything a column holds is a STRING by the time it leaves this file:
// the wheel only ever sees strings, so an object `range` is flattened here
// with `range-key` (specs/008-picker Q3) and nothing but scalars crosses the
// bridge (constitution II).

/** One wheel column: the labels it shows, and which one is selected. */
export interface PickerColumn {
  items: string[];
  index: number;
}

export type PickerMode = 'selector' | 'multiSelector' | 'time' | 'date';
export type DateFields = 'year' | 'month' | 'day';

/** Clamps to the last item, the way the mini program does: "数字大于
 * picker-view-column 可选项长度时，选择最后一项". */
export function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index) || index < 0) return 0;
  if (length <= 0) return 0;
  return Math.min(Math.floor(index), length - 1);
}

/** `range` (+ `rangeKey`) -> labels. Objects without the key fall back to
 * their own string form rather than rendering "[object Object]" silently. */
export function flattenRange(
  range: readonly unknown[] | undefined,
  rangeKey?: string,
): string[] {
  if (!Array.isArray(range)) return [];
  return range.map((item) => {
    if (item != null && typeof item === 'object') {
      const record = item as Record<string, unknown>;
      if (rangeKey && rangeKey in record) return String(record[rangeKey]);
      return JSON.stringify(item);
    }
    return String(item);
  });
}

// ---- time -------------------------------------------------------------------

const TIME_RE = /^(\d{1,2}):(\d{1,2})$/;

/** Minutes since midnight, or null when the string is not "hh:mm". */
export function parseTime(value: string | undefined): number | null {
  const m = TIME_RE.exec((value ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Two columns (hours, minutes), cropped to [start, end].
 *
 * The minute column depends on the hour: at the boundary hour only part of
 * the minutes are legal, which is why it is recomputed from `hourIndex`
 * rather than being a fixed 0-59 list. */
export function timeColumns(
  value: string | undefined,
  start: string | undefined,
  end: string | undefined,
): PickerColumn[] {
  const min = parseTime(start) ?? 0;
  const max = parseTime(end) ?? 23 * 60 + 59;
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);

  const hours: number[] = [];
  for (let h = Math.floor(lo / 60); h <= Math.floor(hi / 60); h++) hours.push(h);

  const current = parseTime(value);
  const clamped = current == null ? lo : Math.min(Math.max(current, lo), hi);
  const hourIndex = Math.max(0, hours.indexOf(Math.floor(clamped / 60)));

  const hour = hours[hourIndex] ?? hours[0] ?? 0;
  const minuteFrom = hour === Math.floor(lo / 60) ? lo % 60 : 0;
  const minuteTo = hour === Math.floor(hi / 60) ? hi % 60 : 59;
  const minutes: number[] = [];
  for (let m = minuteFrom; m <= minuteTo; m++) minutes.push(m);

  const minuteIndex = Math.max(0, minutes.indexOf(clamped % 60));
  return [
    { items: hours.map(pad2), index: hourIndex },
    { items: minutes.map(pad2), index: minuteIndex },
  ];
}

export function timeFromColumns(columns: PickerColumn[]): string {
  const h = Number(columns[0]?.items[columns[0].index] ?? '0');
  const m = Number(columns[1]?.items[columns[1].index] ?? '0');
  return `${pad2(h)}:${pad2(m)}`;
}

// ---- date -------------------------------------------------------------------

const DATE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

export interface YMD {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

export function parseDate(value: string | undefined): YMD | null {
  const m = DATE_RE.exec((value ?? '').trim());
  if (!m) return null;
  const ymd = { year: +m[1], month: +m[2], day: +m[3] };
  if (ymd.month < 1 || ymd.month > 12 || ymd.day < 1) return null;
  if (ymd.day > daysInMonth(ymd.year, ymd.month)) return null;
  return ymd;
}

export function formatDate(ymd: YMD): string {
  return `${ymd.year}-${pad2(ymd.month)}-${pad2(ymd.day)}`;
}

/** Day 0 of the next month is the last day of this one — no leap-year
 * table, and the runtime already knows the rules. */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function compareYMD(a: YMD, b: YMD): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}

function clampDate(value: YMD, lo: YMD, hi: YMD): YMD {
  if (compareYMD(value, lo) < 0) return lo;
  if (compareYMD(value, hi) > 0) return hi;
  return value;
}

const DEFAULT_START: YMD = { year: 1970, month: 1, day: 1 };
const DEFAULT_END: YMD = { year: 2100, month: 12, day: 31 };

/** Year / month / day columns, cropped to [start, end] and cut short by
 * `fields`. Month and day exist only where they are actually free: at the
 * boundary year the month list is partial, and at the boundary month so is
 * the day list. */
export function dateColumns(
  value: string | undefined,
  start: string | undefined,
  end: string | undefined,
  fields: DateFields = 'day',
): PickerColumn[] {
  const lo = parseDate(start) ?? DEFAULT_START;
  const hiRaw = parseDate(end) ?? DEFAULT_END;
  const hi = compareYMD(hiRaw, lo) < 0 ? lo : hiRaw;
  const today = new Date();
  const current = clampDate(
    parseDate(value) ?? {
      year: today.getFullYear(),
      month: today.getMonth() + 1,
      day: today.getDate(),
    },
    lo,
    hi,
  );

  const years: number[] = [];
  for (let y = lo.year; y <= hi.year; y++) years.push(y);
  const yearIndex = Math.max(0, years.indexOf(current.year));
  const columns: PickerColumn[] = [
    { items: years.map((y) => String(y)), index: yearIndex },
  ];
  if (fields === 'year') return columns;

  const year = years[yearIndex] ?? lo.year;
  const monthFrom = year === lo.year ? lo.month : 1;
  const monthTo = year === hi.year ? hi.month : 12;
  const months: number[] = [];
  for (let m = monthFrom; m <= monthTo; m++) months.push(m);
  const monthIndex = Math.max(0, months.indexOf(current.month));
  columns.push({ items: months.map(pad2), index: monthIndex });
  if (fields === 'month') return columns;

  const month = months[monthIndex] ?? monthFrom;
  const dayFrom = year === lo.year && month === lo.month ? lo.day : 1;
  const dayTo =
    year === hi.year && month === hi.month
      ? hi.day
      : daysInMonth(year, month);
  const days: number[] = [];
  for (let d = dayFrom; d <= dayTo; d++) days.push(d);
  const dayIndex = Math.max(0, days.indexOf(current.day));
  columns.push({ items: days.map(pad2), index: dayIndex });
  return columns;
}

/** The date those columns spell. Missing columns (a coarser `fields`) take
 * the lowest legal value, so the result is always a full YYYY-MM-DD. */
export function dateFromColumns(columns: PickerColumn[]): string {
  const pick = (i: number, fallback: number) => {
    const column = columns[i];
    if (!column) return fallback;
    return Number(column.items[column.index] ?? fallback);
  };
  const year = pick(0, new Date().getFullYear());
  const month = pick(1, 1);
  const day = Math.min(pick(2, 1), daysInMonth(year, month));
  return formatDate({ year, month, day });
}

// ---- selector / multiSelector ----------------------------------------------

export function selectorColumns(
  range: readonly unknown[] | undefined,
  rangeKey: string | undefined,
  value: unknown,
): PickerColumn[] {
  const items = flattenRange(range, rangeKey);
  return [{ items, index: clampIndex(Number(value ?? 0), items.length) }];
}

export function multiSelectorColumns(
  range: readonly unknown[] | undefined,
  rangeKey: string | undefined,
  value: unknown,
): PickerColumn[] {
  const columns = Array.isArray(range) ? range : [];
  const indexes = Array.isArray(value) ? (value as unknown[]) : [];
  return columns.map((column, i) => {
    const items = flattenRange(column as readonly unknown[], rangeKey);
    return { items, index: clampIndex(Number(indexes[i] ?? 0), items.length) };
  });
}

/** The columns a mode starts with. Returns null for an unknown mode so the
 * caller can warn instead of silently rendering an empty wheel
 * (constitution V). */
export function columnsFor(
  mode: string,
  props: {
    range?: readonly unknown[];
    rangeKey?: string;
    value?: unknown;
    start?: string;
    end?: string;
    fields?: DateFields;
  },
): PickerColumn[] | null {
  switch (mode) {
    case 'selector':
      return selectorColumns(props.range, props.rangeKey, props.value);
    case 'multiSelector':
      return multiSelectorColumns(props.range, props.rangeKey, props.value);
    case 'time':
      return timeColumns(
        typeof props.value === 'string' ? props.value : undefined,
        props.start,
        props.end,
      );
    case 'date':
      return dateColumns(
        typeof props.value === 'string' ? props.value : undefined,
        props.start,
        props.end,
        props.fields,
      );
    default:
      return null;
  }
}

/** The payload a mode's `@change` carries. Always a string — the same one
 * on both platforms. */
export function valueFor(mode: string, columns: PickerColumn[]): string {
  switch (mode) {
    case 'selector':
      return String(columns[0]?.index ?? 0);
    case 'multiSelector':
      return JSON.stringify(columns.map((c) => c.index));
    case 'time':
      return timeFromColumns(columns);
    case 'date':
      return dateFromColumns(columns);
    default:
      return '';
  }
}

/** Re-derives the columns after one of them moved.
 *
 * time and date are interdependent (February has 28 days until the year
 * changes), so they are rebuilt from the value they now spell. selector and
 * multiSelector are independent — a moved column only changes its own
 * index, and the page owns any linkage via `@columnchange`. */
export function reflow(
  mode: string,
  columns: PickerColumn[],
  props: { start?: string; end?: string; fields?: DateFields },
): PickerColumn[] {
  if (mode === 'time') {
    return timeColumns(timeFromColumns(columns), props.start, props.end);
  }
  if (mode === 'date') {
    return dateColumns(
      dateFromColumns(columns),
      props.start,
      props.end,
      props.fields,
    );
  }
  return columns;
}
