// The 'vue' entry for fjs builds. Generated SFC code imports helpers
// (useCssVars) from 'vue' that runtime-core alone does not export; this
// shim re-exports the pinned runtime-core plus the fjs implementations.
// vuePinPlugin resolves 'vue' here, keeping exactly one physical runtime
// copy (the re-export points at the same pinned dist file).
//
// The pinned runtime-core has no Transition components — the Flutter
// renderer drives transitions natively — but libraries still import the
// NAMES. @vueuse/core (via @vueuse/motion) imports TransitionGroup for one
// helper it only renders with a transition configured; the bare import
// still has to resolve. The stand-in renders its slot as a plain fragment,
// which is what a group with no transition reduces to.
import { Fragment, defineComponent, h } from '@vue/runtime-core';
export * from '@vue/runtime-core';
export { useCssVars } from './css-vars';
export const TransitionGroup = defineComponent({
  name: 'TransitionGroup',
  setup(_, { slots }) {
    return () => slots.default?.() ?? h(Fragment, null);
  },
});
