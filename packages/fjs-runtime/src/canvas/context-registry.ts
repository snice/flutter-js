// getContext is a registry, not a switch.
//
// `canvas.getContext('2d')` is one member of a family the web keeps
// extending — 'webgl', 'webgl2', 'webgpu', 'bitmaprenderer'. Only '2d' is
// implemented here (spec §2), but a context type is exactly the kind of
// thing that should arrive as a module later: a WebGL context needs a
// different host widget, a different command protocol and a much larger
// surface, and none of that should have to touch the `canvas` tag, the
// element layer or this file's callers.
//
// So the tag knows about "context types" and nothing else, and an
// unregistered type is a warn-once + null on BOTH platforms. The web build
// could hand back a real WebGL context — the browser has one — and that is
// precisely why it does not: a page that works in the browser and paints
// nothing in the app is the failure constitution I exists to prevent.
import { FjsCanvasRenderingContext2D, type CanvasSurface } from './context-2d';
import { warnCanvasOnce } from './warn';

/** What a factory is handed. Exactly one of `surface` / `domCanvas` is set:
 * the Flutter path draws through a display list, the web path through the
 * browser's own context. */
export interface CanvasContextTarget {
  /** The object pages see as `canvas` (and as `ctx.canvas`). */
  canvas: unknown;
  /** Flutter path. */
  surface?: CanvasSurface;
  /** Web path: the real <canvas>. */
  domCanvas?: {
    getContext(type: string, attrs?: unknown): unknown;
  };
}

export type CanvasContextFactory = (
  target: CanvasContextTarget,
  attributes?: unknown,
) => unknown;

const factories = new Map<string, CanvasContextFactory>();

/** Registers an implementation for a context type. This is the seam a
 * future `@ufjs/webgl` plugs into; nothing else about `canvas` changes. */
export function registerContextType(
  type: string,
  factory: CanvasContextFactory,
): void {
  factories.set(type, factory);
}

export function hasContextType(type: string): boolean {
  return factories.has(type);
}

/** Resolves a context, caching per (canvas, type) — the DOM returns the same
 * object every time, and a page that calls getContext twice must not end up
 * with two independent state machines. */
export function resolveContext(
  cache: Map<string, unknown>,
  type: string,
  target: CanvasContextTarget,
  attributes?: unknown,
): unknown {
  const cached = cache.get(type);
  if (cached !== undefined) return cached;
  const factory = factories.get(type);
  if (!factory) {
    warnCanvasOnce(
      `context:${type}`,
      `canvas.getContext("${type}") is not supported by fjs; only "2d" is ` +
        'implemented (see docs/canvas-compat.md). Returning null on both ' +
        'Flutter and web so a page behaves the same on either.',
    );
    cache.set(type, null);
    return null;
  }
  const context = factory(target, attributes);
  cache.set(type, context);
  return context;
}

registerContextType('2d', (target) => {
  if (target.domCanvas) return target.domCanvas.getContext('2d');
  if (!target.surface) return null;
  return new FjsCanvasRenderingContext2D(target.surface, target.canvas);
});
