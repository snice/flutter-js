// Shared setup for the canvas suites: a surface with no host behind it, and
// a way to call getContext twice while watching what got warned.
import { resolveContext } from '../../src/canvas/context-registry';
import { CanvasWriter } from '../../src/canvas/display-list';
import { resetCanvasWarnings } from '../../src/canvas/warn';
import type { CanvasSurface } from '../../src/canvas/context-2d';

export function testSurface(width = 300, height = 200): CanvasSurface {
  return {
    nodeId: 1,
    writer: new CanvasWriter(() => {}),
    width: () => width,
    height: () => height,
  };
}

export const resolveCanvasContextForTest = {
  reset(): void {
    resetCanvasWarnings();
  },

  /** Resolves `type` twice through one cache, capturing console warnings. */
  twice(type: string): { first: unknown; second: unknown; warnings: string[] } {
    const cache = new Map<string, unknown>();
    const surface = testSurface();
    const canvas = {};
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    };
    try {
      const first = resolveContext(cache, type, { canvas, surface });
      const second = resolveContext(cache, type, { canvas, surface });
      return { first, second, warnings };
    } finally {
      console.warn = original;
    }
  },
};
