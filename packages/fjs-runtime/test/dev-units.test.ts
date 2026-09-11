import { describe, expect, it, vi } from 'vitest';
import { defineUnit, isUnitEvaluated, requireUnit } from '../src/dev-units';

// ids are unique per test: the registry is a global shared by the whole
// file (it lives on globalThis in the real VM too)
describe('dev unit registry', () => {
  it('runs the factory once and caches the exports', () => {
    const factory = vi.fn((require, module) => {
      module.exports = { n: 1 };
    });
    defineUnit('t1/a.ts', factory);
    expect(requireUnit('t1/a.ts')).toEqual({ n: 1 });
    expect(requireUnit('t1/a.ts')).toBe(requireUnit('t1/a.ts'));
    expect(factory).toHaveBeenCalledTimes(1);
    expect(isUnitEvaluated('t1/a.ts')).toBe(true);
  });

  it('gives a re-defined unit fresh exports on the next require', () => {
    defineUnit('t2/a.ts', (require, module) => {
      module.exports = { v: 'old' };
    });
    const first = requireUnit('t2/a.ts');
    defineUnit('t2/a.ts', (require, module) => {
      module.exports = { v: 'new' };
    });
    const second = requireUnit('t2/a.ts');
    expect(first).toEqual({ v: 'old' });
    expect(second).toEqual({ v: 'new' });
  });

  it('resolves cycles with partial exports, like CommonJS', () => {
    defineUnit('t3/a.ts', (require, module) => {
      const b = require('t3/b.ts') as { fromB: string; aWas?: string };
      module.exports = { fromA: 'a', bHad: b.fromB };
    });
    defineUnit('t3/b.ts', (require, module) => {
      const a = require('t3/a.ts') as { fromA?: string };
      module.exports = { fromB: 'b', aWas: a.fromA };
    });
    const a = requireUnit('t3/a.ts');
    // b started while a was mid-init, so b saw a's partial exports and a
    // sees b's finished ones — the Node shape
    expect(a).toEqual({ fromA: 'a', bHad: 'b' });
    expect(requireUnit('t3/b.ts')).toEqual({ fromB: 'b', aWas: undefined });
  });

  it('throws loudly on a unit that was never loaded, warning once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(() => requireUnit('t4/missing.ts')).toThrow('not loaded');
      expect(() => requireUnit('t4/missing.ts')).toThrow('not loaded');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('t4/missing.ts');
    } finally {
      warn.mockRestore();
    }
  });
});
