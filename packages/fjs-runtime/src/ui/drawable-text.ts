/** Drops the characters a browser draws as nothing.
 *
 * A host font has no glyph for a C0 control, and the two platforms disagree
 * about what to do with that: the browser's shaper skips it, while Flutter's
 * TextPainter falls back to `.notdef` and paints a tofu box. Same page, same
 * string, different picture — which is the divergence constitution I exists
 * to prevent, and it is not hypothetical: ECharts names an unnamed series
 * `series\u00000` (its DUMMY_COMPONENT_NAME_PREFIX is literally `'series\0'`),
 * so every default tooltip on a series the page did not name rendered as
 * `series▤0` on the app and `series0` on the web.
 *
 * Used by both `fillText` (canvas display list) and `setText` (ordinary
 * `<text>` nodes). Slot tooltips sit on the second path — stripping only
 * inside the 2D context left overlay labels still painting tofu.
 *
 * Tab and newline are kept: they have layout meaning, and both platforms
 * honour them. */
export function drawableText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}
