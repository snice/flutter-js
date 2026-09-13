// Template helpers for dynamic class/style bindings. WXML's {{}} can't run
// function calls or build strings, so the compiler routes object/array
// :class and every :style binding through a compiled computed that ends
// here. Same output contract on both: a plain string for the attribute.

/** Vue :class semantics — string | object | (nested) array — flattened to
 * `a b c`. Falsy values and unknown shapes are skipped. */
export function stringifyClass(value: unknown): string {
  return joinClass(value, new Set()).trim().replace(/\s+/g, ' ');
}

function joinClass(value: unknown, seen: Set<object>): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((v) => joinClass(v, seen)).join(' ');
  if (typeof value === 'object') {
    if (seen.has(value as object)) return '';
    seen.add(value as object);
    try {
      // a ref of class data (e.g. computed) — snapshot() in instance.ts
      // already unwraps refs before data reaches wxml, but a computed
      // binding evaluated here may still be one
      if ((value as { __v_isRef?: boolean }).__v_isRef === true) {
        return joinClass((value as { value: unknown }).value, seen);
      }
      return Object.entries(value as Record<string, unknown>)
        .filter(([, on]) => Boolean(on))
        .map(([cls]) => cls)
        .join(' ');
    } finally {
      seen.delete(value as object);
    }
  }
  return String(value);
}

/** Vue :style semantics → inline CSS text. Keys are used as written
 * (camelCase keys are converted, matching Vue's behavior on the web). */
export function stringifyStyle(value: unknown): string {
  return joinStyle(value, new Set()).replace(/;+/g, ';').replace(/^;|;$/g, '');
}

function joinStyle(value: unknown, seen: Set<object>): string {
  if (!value) return '';
  if (typeof value === 'string') return value.endsWith(';') ? value : value + ';';
  if (Array.isArray(value)) return value.map((v) => joinStyle(v, seen)).join('');
  if (typeof value === 'object') {
    if (seen.has(value as object)) return '';
    seen.add(value as object);
    try {
      if ((value as { __v_isRef?: boolean }).__v_isRef === true) {
        return joinStyle((value as { value: unknown }).value, seen);
      }
      return Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined && v !== null && v !== false && v !== '')
        .map(([k, v]) => `${kebab(k)}:${typeof v === 'number' && !isUnitless(kebab(k)) ? v + 'px' : String(v)};`)
        .join('');
    } finally {
      seen.delete(value as object);
    }
  }
  return '';
}

const UNITLESS = new Set([
  'flex', 'flex-grow', 'flex-shrink', 'order', 'z-index', 'opacity',
  'font-weight', 'line-height', 'zoom', 'flex-grow-shrink', 'aspect-ratio',
]);

function isUnitless(prop: string): boolean {
  return UNITLESS.has(prop.trim().toLowerCase());
}

function kebab(key: string): string {
  return key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
}
