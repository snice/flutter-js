// Type shim for @vueuse/motion on fjs elements (spec 042).
//
// The variant props (`:variants` / `:initial` / `:enter` / ...) are declared
// structurally on every fjs tag by @ufjs/runtime's vue-global.d.ts, so this
// file only needs to name the directive itself: motion ships no
// GlobalDirectives augmentation, so vue-tsc cannot resolve `v-motion`
// without it.
import type { Directive } from 'vue';
import type { MotionVariants } from '@vueuse/motion';

declare module '@vue/runtime-core' {
  interface GlobalDirectives {
    vMotion: Directive<unknown, string | MotionVariants<string> | undefined>;
  }
}
