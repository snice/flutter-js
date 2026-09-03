// The globals the native core installs into the QuickJS context.
//
// Authoritative source: packages/flutter_fjs/native/src/natives.cpp (the
// `__fjs` object) and native/src/vm.cpp (which calls __fjsDispatchEvent).
// Keep this file in step with those two — it is the only description of
// that boundary the type system gets.
//
// Nothing here exists in a browser: the web build has no engine, so `__fjs`
// is typed as possibly undefined and every use has to prove it is there.
// The runtime funnels all of it through host.ts (`hasNativeHost`, `host`,
// `invokeHost`, `nowMs`, `toast`); prefer those over touching `__fjs`.
//
// A script, not a module — no top-level import/export — so these land in
// the global scope. `var` rather than `const` because that is what makes
// them properties of globalThis in TypeScript's model, which is how they
// are really reached (and, for __fjsDispatchEvent, assigned).

interface FjsEngineInfo {
  engineId: string;
  abiVersion: number;
}

/** Values that survive the sync C ABI in v1 — see
 * docs/jsi-and-native-modules.md. */
type FjsHostValue = string | number | boolean | null;

interface FjsNativeFns {
  setTimeout(cb: () => void, ms: number): number;
  clearTimeout(id: number): void;
  setInterval(cb: () => void, ms: number): number;
  clearInterval(id: number): void;
  /** Submits one encoded UI frame. */
  uiOps(buffer: Uint8Array): void;
  /** Calls a Dart-side host module. Synchronous: the Dart handler runs to
   * completion before this returns. */
  invokeHost(name: string, ...args: FjsHostValue[]): unknown;
  nowMs(): number;
  /** Collects now, returning the heap size on either side and the surviving
   * object count. QuickJS otherwise collects wherever an allocation happens
   * to cross its threshold, which on a busy frame is in the middle of the
   * work the user is watching. */
  gc(): { before: number; after: number; objects: number };
  toast(message: string): void;
  engine: FjsEngineInfo;
}

interface FjsNative {
  fns: FjsNativeFns;
  /** Demo natives exposed for discoverability (fibonacci). */
  natives: Record<string, (...args: unknown[]) => unknown>;
  engine: FjsEngineInfo;
}

/** Event types the native layer dispatches; 9 is a worker message, the
 * rest are node events (see FjsEvent on the Dart side). */
type FjsEventDispatcher = (
  nodeId: number,
  eventType: number,
  payload: string | null,
) => void;

declare var __fjs: FjsNative | undefined;

/** Installed by the runtime (ui/element.ts), called by the native core. */
declare var __fjsDispatchEvent: FjsEventDispatcher | undefined;

declare function requestAnimationFrame(
  callback: (time: number) => void,
): number;
declare function cancelAnimationFrame(id: number): void;
