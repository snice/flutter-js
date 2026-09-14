// Vue :style value → inline CSS text, with no state and no side effects.
//
// Split out of style.ts so the rich-text pipeline can be bundled on its own
// (fjs/rich-text.js, spec 050) without a second copy of style.ts: that module
// keeps the app's CSS variable table and publishes resolveCssColor on
// globalThis.__fjsWx at load, so a copy would replace the real functions with
// ones reading an empty table.

/** Keys are used as written (camelCase keys are converted, matching Vue's
 * behavior on the web); bare numbers are px unless the property is unitless. */
export function styleToCssText(value: unknown): string {
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
