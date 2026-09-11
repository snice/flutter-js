// HTML entity decoding for rich-text content.
//
// Not the full HTML5 table (2000+ names): content handed to a mini program's
// rich-text is editor output, and editors emit numeric references for
// anything exotic. The named set below is what shows up in practice. An
// entity this does not know is left as written — visible, so the gap is
// noticed, rather than silently eaten.

const NAMED: Record<string, string> = {
  nbsp: '\u00a0',
  ensp: '\u2002',
  emsp: '\u2003',
  thinsp: '\u2009',
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  middot: '·',
  bull: '•',
  times: '×',
  divide: '÷',
  plusmn: '±',
  deg: '°',
  yen: '¥',
  cent: '¢',
  pound: '£',
  euro: '€',
  sect: '§',
  para: '¶',
};

const ENTITY = /&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g;

function fromCodePoint(code: number): string {
  // HTML maps NUL, surrogates and out-of-range references to U+FFFD rather
  // than producing a broken string
  if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
    return '�';
  }
  return String.fromCodePoint(code);
}

export function decodeEntities(text: string): string {
  if (text.indexOf('&') < 0) return text;
  return text.replace(ENTITY, (match, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) ? fromCodePoint(code) : match;
    }
    return NAMED[body] ?? NAMED[body.toLowerCase()] ?? match;
  });
}
