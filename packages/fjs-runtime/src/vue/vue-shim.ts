// The 'vue' entry for fjs builds. Generated SFC code imports helpers
// (useCssVars) from 'vue' that runtime-core alone does not export; this
// shim re-exports the pinned runtime-core plus the fjs implementations.
// vuePinPlugin resolves 'vue' here, keeping exactly one physical runtime
// copy (the re-export points at the same pinned dist file).
export * from '@vue/runtime-core';
export { useCssVars } from './css-vars';
