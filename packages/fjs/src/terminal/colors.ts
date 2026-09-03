export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const RESET = '\x1b[0m';
const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};

export function shouldColor(stream: NodeJS.WriteStream = process.stderr): boolean {
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') return true;
  if (process.env.NO_COLOR) return false;
  return stream.isTTY === true;
}

export function colorByLevel(level: LogLevel, text: string, enabled = shouldColor()): string {
  if (!enabled) return text;
  return `${LEVEL_COLORS[level]}${text}${RESET}`;
}

export function formatLog(level: LogLevel, message: string, enabled = shouldColor()): string {
  return `  ${colorByLevel(level, `${level}: ${message}`, enabled)}`;
}
