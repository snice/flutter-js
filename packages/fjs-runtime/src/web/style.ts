// Style normalization for the web adapter.
//
// Flutter's style parser takes bare numbers as pixels (`:style="{ fontSize:
// 16 }"`), CSS does not. Every fjs component funnels its inherited attrs
// through here so the same template produces valid CSS in the browser.

/** Style properties whose numeric values are NOT lengths. */
const UNITLESS = new Set([
  'opacity',
  'zIndex',
  'flex',
  'flexGrow',
  'flexShrink',
  'order',
  'lineHeight',
  'fontWeight',
  'aspectRatio',
]);

export function normalizeStyleValues(style: unknown): unknown {
  if (!style || typeof style !== 'object' || Array.isArray(style)) return style;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(style as Record<string, unknown>)) {
    out[key] =
      typeof value === 'number' && !UNITLESS.has(key) && !key.startsWith('--')
        ? `${value}px`
        : value;
  }
  return out;
}

/** Attrs to spread onto the host element: normalized style, everything
 * else verbatim. Components using this set `inheritAttrs: false`. */
export function hostAttrs(attrs: Record<string, unknown>): Record<string, unknown> {
  if (!('style' in attrs)) return attrs;
  return { ...attrs, style: normalizeStyleValues(attrs.style) };
}
