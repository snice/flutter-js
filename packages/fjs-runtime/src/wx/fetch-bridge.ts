// Re-exports of the global fetch surface. `fjs` exports fetch/AbortController
// as values on the other platforms; on wx the polyfill (fetch.ts) installs
// the globals, so these just alias them at call time — a static
// `export { fetch } from ...` would bind before the polyfill runs.
export function fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return globalThis.fetch(input, init);
}

export const AbortController =
  typeof globalThis.AbortController === 'function'
    ? globalThis.AbortController
    : // mini-program base libraries without AbortController: fetch never
      // inspects the signal, so a stub keeps importing pages alive
      class AbortControllerStub {
        signal = { aborted: false, reason: undefined, onabort: null };
        abort(): void {
          this.signal.aborted = true;
        }
      };
