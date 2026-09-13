// The 'fjs' module on wx: the slice of the element-API surface that pages
// in scope actually import. Bigger items degrade loudly instead of silently
// — a canvas/Worker API that no-ops would leave a page permanently blank,
// which is harder to diagnose than an immediate error.
import { installFetchPolyfill } from './fetch';

export function toast(message: string): void {
  wx.showToast({ title: String(message), icon: 'none' });
}

export function nowMs(): number {
  return Date.now();
}

// same shape and values as a host-less web page (host.ts): there is no
// fjs engine underneath the mini-program runtime
export const engineInfo = {
  engineId: 'none',
  abiVersion: 0,
};

export function hasNativeHost(): boolean {
  return false;
}

export function invokeHostAsync(_name: string, ..._args: unknown[]): Promise<never> {
  return Promise.reject(new Error('[fjs/wx] invokeHostAsync is not available on the mini-program target'));
}

export function setOpSink(): void {
  // no op sink on wx — nothing consumes UI ops here
}

export { fetch, AbortController } from './fetch-bridge';
export function Worker(): never {
  throw new Error('[fjs/wx] Worker is not available on the mini-program target');
}

installFetchPolyfill();
