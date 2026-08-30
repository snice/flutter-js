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
  // `direction` is scroll-view's own style key, not the CSS property of that
  // name (see injectStyle() for the same rewrite on stylesheet form)
  if (out.direction === 'horizontal' || out.direction === 'vertical') {
    const horizontal = out.direction === 'horizontal';
    delete out.direction;
    out.overflowX = horizontal ? 'auto' : 'hidden';
    out.overflowY = horizontal ? 'hidden' : 'auto';
  }
  // flexGrow is Flutter's Expanded — a share of the leftover space, not the
  // natural size plus a share. Same rewrite injectStyle() does to the CSS
  // form; an explicit flexBasis still wins.
  if (out.flexGrow != null && out.flexBasis == null) out.flexBasis = '0%';
  return out;
}

/** Attrs to spread onto the host element: normalized style, everything
 * else verbatim. Components using this set `inheritAttrs: false`. */
export function hostAttrs(attrs: Record<string, unknown>): Record<string, unknown> {
  if (!('style' in attrs)) return attrs;
  return { ...attrs, style: normalizeStyleValues(attrs.style) };
}
