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
  const css = joinStyle(value, new Set()).replace(/;+/g, ';').replace(/^;|;$/g, '');
  recordCssVars(css);
  return css;
}

// ---- CSS custom properties seen in :style bindings -------------------------
//
// Skyline has no way to read a computed style back (SelectorQuery's
// computedStyle comes back empty), so a component that must paint a color
// outside CSS — icon-mind draws an SVG image, and an image does not inherit
// `color` — cannot resolve `var(--fjs-primary)` by asking the renderer. The
// app's theme variables reach the page through a :style binding (Shell's
// `:style="vars"`), which runs through here: every custom property it sets
// is recorded, and `resolveCssColor` answers from that table. It is one
// table for the whole app — a theme, not per-subtree scoping; a variable
// defined differently in two subtrees resolves to the last one written.

const cssVars = new Map<string, string>();
const cssVarListeners = new Set<() => void>();

function recordCssVars(css: string): void {
  let changed = false;
  for (const decl of css.split(';')) {
    const m = /^\s*(--[\w-]+)\s*:\s*(.+?)\s*$/.exec(decl);
    if (m && cssVars.get(m[1]) !== m[2]) {
      cssVars.set(m[1], m[2]);
      changed = true;
    }
  }
  if (changed) for (const fn of [...cssVarListeners]) fn();
}

/** `#007aff` as is; `var(--name[, fallback])` from the recorded table (nested
 * vars resolved), or its fallback, or '' when nothing is known. */
export function resolveCssColor(value: string | null | undefined, depth = 0): string {
  const v = String(value ?? '').trim();
  const m = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(v);
  if (!m) return v;
  if (depth > 8) return '';
  const hit = cssVars.get(m[1]);
  if (hit !== undefined) return resolveCssColor(hit, depth + 1);
  return m[2] ? resolveCssColor(m[2], depth + 1) : '';
}

/** Calls `fn` whenever a recorded custom property changes (a theme switch).
 * Returns the unsubscribe function. */
export function onCssVarsChange(fn: () => void): () => void {
  cssVarListeners.add(fn);
  return () => cssVarListeners.delete(fn);
}

// Module components are plain Component() files copied from their npm
// package; they cannot import this TypeScript runtime by a stable path, so
// the two functions are also published on a global.
(globalThis as Record<string, unknown>).__fjsWx = {
  ...((globalThis as Record<string, unknown>).__fjsWx as object | undefined),
  resolveCssColor,
  onCssVarsChange,
};

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
