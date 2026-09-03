import { afterEach, describe, expect, it } from 'vitest';
import { colorByLevel, formatLog, shouldColor } from '../src/terminal/colors.js';

const oldForceColor = process.env.FORCE_COLOR;
const oldNoColor = process.env.NO_COLOR;

function restoreEnv(name: 'FORCE_COLOR' | 'NO_COLOR', value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restoreEnv('FORCE_COLOR', oldForceColor);
  restoreEnv('NO_COLOR', oldNoColor);
});

describe('terminal colors', () => {
  it('colors warnings yellow by level', () => {
    expect(colorByLevel('warn', 'warn: careful', true)).toBe('\x1b[33mwarn: careful\x1b[0m');
  });

  it('keeps build warning text plain when color is disabled', () => {
    expect(formatLog('warn', '[fjs perf] too many nodes', false)).toBe(
      '  warn: [fjs perf] too many nodes',
    );
  });

  it('lets FORCE_COLOR override NO_COLOR for explicit terminal previews', () => {
    process.env.FORCE_COLOR = '1';
    process.env.NO_COLOR = '1';

    expect(shouldColor()).toBe(true);
  });
});
