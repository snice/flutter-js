// Terminal QR code for the address `fjs dev` is serving on.
//
// Typing "192.168.1.20:38900" on a phone keyboard is the most annoying step
// of a debug session, so the banner draws the LAN URL as a QR code that
// `fjs go` (and any camera app) can read straight off the terminal.
//
// Two modules per character cell: the upper-half block paints the foreground
// colour into the top half of the cell and the background colour into the
// bottom half, so a row pair costs one text line and a module ends up roughly
// square. Colours are written out explicitly — a QR drawn with the terminal's
// own colours comes out inverted on a dark theme, which many scanners (the
// iOS camera among them) refuse to read.
import qrcode from 'qrcode-generator';

const UPPER_HALF = '▀';
const RESET = '\x1b[0m';
const BLACK_FG = '\x1b[38;2;0;0;0m';
const WHITE_FG = '\x1b[38;2;255;255;255m';
const BLACK_BG = '\x1b[48;2;0;0;0m';
const WHITE_BG = '\x1b[48;2;255;255;255m';

/** Modules of quiet zone. Four is what the spec asks for; scanners that
 * meter the border reject a code pressed up against other terminal output. */
const QUIET = 4;

export interface QrOptions {
  /** false renders block glyphs without ANSI colour (NO_COLOR, piped logs).
   * The code then reads inverted on a dark terminal — fine to look at, not
   * reliably scannable. */
  color?: boolean;
}

/** The QR for `text`, one string per terminal line, no trailing newline. */
export function qrLines(text: string, opts: QrOptions = {}): string[] {
  const color = opts.color ?? true;
  // 'M' (~15% recovery) is the usual default: a version smaller than 'Q' at
  // this payload size, and a terminal is a clean, flat "print".
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();

  const count = qr.getModuleCount();
  const size = count + QUIET * 2;
  const dark = (row: number, col: number): boolean => {
    const r = row - QUIET;
    const c = col - QUIET;
    if (r < 0 || c < 0 || r >= count || c >= count) return false; // quiet zone
    return qr.isDark(r, c);
  };

  const lines: string[] = [];
  for (let row = 0; row < size; row += 2) {
    let line = '';
    for (let col = 0; col < size; col++) {
      const top = dark(row, col);
      // an odd module count leaves the last line's bottom half in the quiet
      // zone, which is exactly what it should be: light
      const bottom = row + 1 < size ? dark(row + 1, col) : false;
      line += color ? colorCell(top, bottom) : plainCell(top, bottom);
    }
    lines.push(color ? line + RESET : line);
  }
  return lines;
}

/** One colour cell: foreground = top module, background = bottom module. */
function colorCell(top: boolean, bottom: boolean): string {
  return (top ? BLACK_FG : WHITE_FG) + (bottom ? BLACK_BG : WHITE_BG) + UPPER_HALF;
}

/** Colourless fallback: the glyph alone carries both halves. */
function plainCell(top: boolean, bottom: boolean): string {
  if (top && bottom) return '█';
  if (top) return '▀';
  if (bottom) return '▄';
  return ' ';
}

/** Whether ANSI colour is safe to emit on `stream`. */
export function colorSupported(stream: NodeJS.WriteStream = process.stdout): boolean {
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') return true;
  if (process.env.NO_COLOR) return false;
  if (process.env.TERM === 'dumb') return false;
  return stream.isTTY === true;
}
