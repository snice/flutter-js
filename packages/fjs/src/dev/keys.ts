// Terminal keyboard shortcuts for long-running commands (`fjs dev`).
//
// A dev server spends its life waiting, and the terminal it waits in is
// otherwise dead: reloading, checking who is connected or re-showing the QR
// code all meant a second terminal. One keypress each is cheaper.
//
// Only when stdin is a TTY: piped into a file, run under CI or spawned by
// another process (`fjs run` does exactly that), there is nobody to press a
// key and raw mode would break the parent's own input.
import { colorSupported } from './qrcode.js';

export interface KeyCommand {
  /** The character to press. One key, lowercase; a shifted key is written
   * as the uppercase letter and shown as `shift+x`. */
  key: string;
  /** What it does, for the help block. */
  label: string;
  run(): void | Promise<void>;
}

export interface KeyboardHandle {
  /** Prints the shortcut list (also bound to `?`). */
  help(): void;
  stop(): void;
}

const CTRL_C = '\u0003';
const CTRL_D = '\u0004';

/** Binds [commands] to single keypresses on stdin. `?` prints the list and
 * `q`/Ctrl-C quit, so a caller never has to provide those.
 *
 * Returns null when stdin cannot be read this way — the caller keeps
 * working exactly as before, minus the shortcuts. */
export function startKeyboard(commands: KeyCommand[]): KeyboardHandle | null {
  const stdin = process.stdin;
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') return null;

  const color = colorSupported();
  const bold = (text: string) => (color ? `\x1B[1m${text}\x1B[0m` : text);
  const dim = (text: string) => (color ? `\x1B[2m${text}\x1B[0m` : text);

  const help = () => {
    console.log('');
    for (const { key, label } of commands) {
      console.log(`  ${dim('>')} ${bold(pad(key))} ${dim('|')} ${label}`);
    }
    console.log(`  ${dim('>')} ${bold(pad('?'))} ${dim('|')} show this list again`);
    console.log(`  ${dim('>')} ${bold(pad('q'))} ${dim('|')} quit ${dim('(or Ctrl+C)')}`);
    console.log('');
  };

  const stop = () => {
    stdin.off('data', onData);
    if (stdin.isTTY) stdin.setRawMode(false);
    stdin.pause();
  };

  const quit = () => {
    stop();
    console.log('');
    process.exit(0);
  };

  function onData(data: string): void {
    const key = data.toString();
    if (key === CTRL_C || key === CTRL_D || key === 'q') return quit();
    if (key === '?' || key === 'h') return help();
    const command = commands.find((c) => c.key === key);
    if (!command) return;
    try {
      // a shortcut that throws must not take the dev server down with it
      void Promise.resolve(command.run()).catch(report);
    } catch (e) {
      report(e);
    }
  }

  stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  stdin.resume();
  stdin.on('data', onData);
  // raw mode outlives the process otherwise, and the shell it came back to
  // stops echoing — the classic "my terminal is broken" after a tool exits
  process.on('exit', () => {
    if (stdin.isTTY) stdin.setRawMode(false);
  });

  return { help, stop };
}

function report(e: unknown): void {
  console.error('fjs:', e instanceof Error ? e.message : e);
}

/** Keys line up in the help block; `shift+r` is the widest thing shown. */
function pad(key: string): string {
  const label = key >= 'A' && key <= 'Z' ? `shift+${key.toLowerCase()}` : key;
  return label.padEnd(7);
}
