// The "vue" module on the mini-program target. The SFC compiler emits
// `import { ref } from 'vue'` exactly as on the other two platforms; here
// that specifier resolves to this file, which re-exports the reactivity
// kernel (@vue/reactivity — no virtual DOM, no runtime-core) and provides
// the lifecycle registrars as plain hook collectors.
//
// There is deliberately NO component/render implementation here: templates
// are compiled to WXML and never render through Vue, so `defineComponent`
// is an identity and the lifecycle hooks are lists that instance.ts drains
// when the matching mini-program lifetime fires.
export {
  computed,
  reactive,
  readonly,
  ref,
  shallowReactive,
  shallowReadonly,
  shallowRef,
  customRef,
  effect,
  effectScope,
  getCurrentScope,
  onScopeDispose,
  isProxy,
  isReactive,
  isReadonly,
  isRef,
  markRaw,
  proxyRefs,
  stop,
  toRaw,
  toRef,
  toRefs,
  toValue,
  triggerRef,
  unref,
  watch,
} from '@vue/reactivity';
export type {
  ComputedRef,
  ReactiveEffect,
  Ref,
  ShallowRef,
  ToRef,
  WatchCallback,
  WatchSource,
  WatchStopHandle,
} from '@vue/reactivity';

import { effect, stop } from '@vue/reactivity';

export function defineComponent<T>(options: T): T {
  return options;
}

/** nextTick lives in runtime-core upstream; here the microtask IS the flush
 * (setData batching runs on the same queue), so a bare promise suffices. */
export function nextTick(fn?: () => void): Promise<void> {
  return Promise.resolve().then(fn);
}

/** watchEffect over reactivity's raw effect: fn re-runs when anything it
 * reads changes; the returned handle stops it (watchEffect's own contract). */
export function watchEffect(fn: () => unknown): () => void {
  const e = effect(fn);
  return () => stop(e);
}

/** Hook kinds we support, in mini-program lifetime terms. `mounted` fires
 * at the `ready` lifetime (first render done), `unmounted` at `detached`. */
const HOOK_TYPES = [
  'load',
  'show',
  'hide',
  'ready',
  'mounted',
  'before-unmounted',
  'unmounted',
  'unload',
] as const;
export type HookType = (typeof HOOK_TYPES)[number];
export type Hook = (...args: never[]) => void;
export type Hooks = Partial<Record<HookType, Hook[]>>;

/** The currently-setup()-ing instance's hook registry. instance.ts pushes
 * it around the setup() call; outside setup the registrars warn and drop,
 * matching Vue's "onMounted outside setup is a no-op" behavior. */
let currentHooks: Hooks | null = null;

/** @internal — instance.ts only. */
export function __withInstanceHooks<T>(hooks: Hooks, fn: () => T): T {
  const prev = currentHooks;
  currentHooks = hooks;
  try {
    return fn();
  } finally {
    currentHooks = prev;
  }
}

function injectHook(type: HookType, hook: Hook): void {
  if (!currentHooks) {
    console.warn(`[fjs/wx] ${type}() called outside setup() — ignored`);
    return;
  }
  (currentHooks[type] ??= []).push(hook);
}

export const onLoad = (hook: (query: Record<string, string>) => void): void =>
  injectHook('load', hook as Hook);
export const onShow = (hook: () => void): void => injectHook('show', hook);
export const onHide = (hook: () => void): void => injectHook('hide', hook);
export const onReady = (hook: () => void): void => injectHook('ready', hook);
export const onMounted = (hook: () => void): void => injectHook('mounted', hook);
export const onBeforeUnmount = (hook: () => void): void =>
  injectHook('before-unmounted', hook);
export const onUnmounted = (hook: () => void): void =>
  injectHook('unmounted', hook);
export const onUnload = (hook: () => void): void => injectHook('unload', hook);
// keep-alive hooks have no wx lifetime of their own; page show/hide is the
// closest semantic (a kept-alive component toggles on navigation back)
export const onActivated = (hook: () => void): void => injectHook('show', hook);
export const onDeactivated = (hook: () => void): void => injectHook('hide', hook);

/** Fires the hooks registered under `type` on `hooks`, swallowing errors
 * so one bad page hook doesn't kill the mini-program's error surface
 * (WeChat shows them, but the others should still run). */
export function runHooks(hooks: Hooks | undefined, type: HookType, ...args: unknown[]): void {
  for (const hook of hooks?.[type] ?? []) {
    try {
      (hook as (...a: unknown[]) => void)(...args);
    } catch (err) {
      console.error(`[fjs/wx] ${type} hook failed:`, err);
    }
  }
}
