// textarea's prop vocabulary, shared by the component and the web adapter,
// and mirrored on the Dart side by widgets/input.dart.
//
// The values live here rather than in either adapter for the same reason
// scroll/metrics.ts exists: a default that disagrees between platforms is
// invisible until someone runs the same page twice.

/** The mini program's default, and NOT `input`'s (-1, no limit). Writing
 * `<textarea>` with no maxlength truncates at 140. */
export const TEXTAREA_DEFAULT_MAXLENGTH = 140;

/** Keyboard confirm keys. `return` means "the key inserts a newline", which
 * is why it is the default for a multiline field and why it does not fire
 * `@confirm`. */
export const CONFIRM_TYPES = [
  'send',
  'search',
  'next',
  'go',
  'done',
  'return',
] as const;

export type ConfirmType = (typeof CONFIRM_TYPES)[number];

const CONFIRM_SET = new Set<string>(CONFIRM_TYPES);

export function normalizeConfirmType(
  raw: unknown,
  warn: (message: string) => void = () => {},
): ConfirmType {
  if (raw === undefined || raw === null || raw === '') return 'return';
  const value = String(raw);
  if (CONFIRM_SET.has(value)) return value as ConfirmType;
  warn(
    `<textarea> got confirm-type="${value}", which is not one of ` +
      `${CONFIRM_TYPES.join(' / ')}; using "return".`,
  );
  return 'return';
}

/** The four `placeholder-style` keys both platforms can honour. Flutter maps
 * them onto the hint's TextStyle, the web onto `::placeholder`; anything
 * else has no counterpart on one side or the other, so it is warned about
 * rather than half-applied (constitution V). */
export const PLACEHOLDER_STYLE_KEYS = [
  'color',
  'font-size',
  'font-weight',
  'line-height',
] as const;

const PLACEHOLDER_SET = new Set<string>(PLACEHOLDER_STYLE_KEYS);

export type PlaceholderStyle = Partial<
  Record<(typeof PLACEHOLDER_STYLE_KEYS)[number], string>
>;

/** Parses the `placeholder-style` string. Unknown keys warn and are dropped;
 * the string is CSS-shaped (`color: #ccc; font-size: 12px`) because that is
 * what the mini program accepts and what a page author will type. */
export function parsePlaceholderStyle(
  raw: unknown,
  warn: (message: string) => void = () => {},
): PlaceholderStyle {
  const out: PlaceholderStyle = {};
  if (raw === undefined || raw === null || raw === '') return out;
  for (const part of String(raw).split(';')) {
    const at = part.indexOf(':');
    if (at < 0) continue;
    const key = part.slice(0, at).trim().toLowerCase();
    const value = part.slice(at + 1).trim();
    if (!key || !value) continue;
    if (!PLACEHOLDER_SET.has(key)) {
      warn(
        `<textarea> placeholder-style does not support "${key}"; only ` +
          `${PLACEHOLDER_STYLE_KEYS.join(' / ')} reach both platforms.`,
      );
      continue;
    }
    out[key as keyof PlaceholderStyle] = value;
  }
  return out;
}

/** Props the mini program has and fjs deliberately does not implement — the
 * keyboard and native-webview knobs (specs/012 §2). Accepting them silently
 * would be the worst outcome: the page would look correct and behave
 * differently. */
export const UNSUPPORTED_TEXTAREA_PROPS = [
  'cursorSpacing',
  'adjustPosition',
  'holdKeyboard',
  'showConfirmBar',
  'fixed',
  'adjustKeyboardTo',
  'disableDefaultPadding',
  'cursor',
  'selectionStart',
  'selectionEnd',
] as const;
