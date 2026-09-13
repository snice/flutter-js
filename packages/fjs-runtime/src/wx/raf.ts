// requestAnimationFrame / cancelAnimationFrame on wx. The mini-program logic
// layer has no frame callback of its own (only a canvas node carries one),
// yet page code uses it on the other two ends — to wait out a frame before
// a transition, or to drive a game loop. A ~60Hz timer stands in: the logic
// layer cannot see the render thread's vsync anyway, and setData is applied
// asynchronously, so "next frame" can only ever mean "a frame's time later".
// The callback receives a DOMHighResTimeStamp-like millisecond clock.
//


const FRAME_MS = 16;
const start = Date.now();

export function requestAnimationFrame(cb: (time: number) => void): number {
  return setTimeout(() => cb(Date.now() - start), FRAME_MS) as unknown as number;
}

export function cancelAnimationFrame(id: number): void {
  clearTimeout(id);
}

/** The global form, for code that looks it up at runtime. Compiled modules
 * do not reach it: the mini-program module wrapper declares its own
 * (undefined) `requestAnimationFrame`, so the compiler imports the two
 * functions above into any module that names them (script.ts). */
export function installAnimationFramePolyfill(): void {
  const g = globalThis as Record<string, unknown>;
  if (typeof g.requestAnimationFrame === 'function') return;
  g.requestAnimationFrame = requestAnimationFrame;
  g.cancelAnimationFrame = cancelAnimationFrame;
}
