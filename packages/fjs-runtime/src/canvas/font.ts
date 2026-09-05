// The `font` shorthand, parsed once in JS so both platforms agree on what a
// page's font string means.
//
// Only the CSS font shorthand's useful middle is supported:
//
//     [style] [weight] <size>px [family]
//
// Everything else in the real grammar — system keywords (`font: caption`),
// `font-stretch`, `line-height` after the size, non-px units — is out
// (spec §4.2). The host has no cascade to resolve those against: a canvas is
// not in the document, so `1.2em` has nothing to be relative to and
// `caption` names a platform UI font that differs per OS anyway. An
// unparseable string warns once and leaves the previous font in place, which
// is what a browser does with an invalid assignment.
import { warnCanvasOnce } from './warn';

export interface FjsCanvasFont {
  /** Pixels. */
  size: number;
  /** 100-900. */
  weight: number;
  italic: boolean;
  family: string;
}

export const DEFAULT_FONT: FjsCanvasFont = {
  size: 10,
  weight: 400,
  italic: false,
  family: 'sans-serif',
};

const NAMED_WEIGHT: Record<string, number> = {
  normal: 400,
  bold: 700,
  bolder: 700,
  lighter: 300,
};

/** Parses a `font` assignment, or returns null when it is not usable. */
export function parseFont(value: string): FjsCanvasFont | null {
  const text = value.trim();
  if (text === '') return null;
  let italic = false;
  let weight = 400;
  let size = 0;
  let family = '';
  const parts = text.split(/\s+/);
  for (let i = 0; i < parts.length; i++) {
    const token = parts[i];
    if (size === 0) {
      const lower = token.toLowerCase();
      if (lower === 'italic' || lower === 'oblique') {
        italic = true;
        continue;
      }
      if (lower === 'normal') continue;
      if (lower === 'small-caps') continue;
      if (lower in NAMED_WEIGHT) {
        weight = NAMED_WEIGHT[lower];
        continue;
      }
      const numeric = Number(token);
      if (Number.isFinite(numeric) && numeric >= 1 && numeric <= 1000 && !/px$/i.test(token)) {
        weight = numeric;
        continue;
      }
      const px = /^(\d*\.?\d+)px$/i.exec(token);
      if (px) {
        size = Number(px[1]);
        family = parts.slice(i + 1).join(' ');
        break;
      }
      // an unknown token before the size: the string is not the shape above
      return null;
    }
  }
  if (size <= 0) return null;
  return {
    size,
    weight,
    italic,
    family: normalizeFamily(family),
  };
}

/** Takes the first family of a list and strips its quotes. The host resolves
 * one family name; a fallback list would need the platform's font matcher,
 * which Flutter does not expose per-glyph. */
function normalizeFamily(list: string): string {
  const first = list.split(',')[0]?.trim() ?? '';
  const unquoted = first.replace(/^['"]|['"]$/g, '').trim();
  return unquoted === '' ? DEFAULT_FONT.family : unquoted;
}

/** Parse, or warn and keep [current]. */
export function parseFontOrWarn(
  value: string,
  current: FjsCanvasFont,
): FjsCanvasFont {
  const parsed = parseFont(value);
  if (parsed) return parsed;
  warnCanvasOnce(
    `font:${value}`,
    `<canvas> font "${value}" is not supported; fjs parses ` +
      '"[style] [weight] <size>px [family]" (see docs/canvas-compat.md). ' +
      'Keeping the previous font.',
  );
  return current;
}

/** The JSON the host's measureText module takes. Field order is fixed so the
 * two sides can be compared byte for byte in a test. */
export function fontJson(font: FjsCanvasFont): string {
  return JSON.stringify({
    size: font.size,
    weight: font.weight,
    italic: font.italic,
    family: font.family,
  });
}
