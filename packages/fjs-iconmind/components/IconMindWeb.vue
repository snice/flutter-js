<script setup lang="ts">
// Browser stand-in for the Flutter widget <icon-mind />. The build registers
// it under that tag name, so one template line renders the Dart CustomPaint
// on a device and this inline SVG in a browser.
//
// Both sides read what prepare.mjs generated for this app: Dart from the
// host's assets, here through a dynamic import of 'fjs/data/icons.json' —
// the specifier fjs resolves to this module's generated directory. Being a
// dynamic import, the bundler gives it its own chunk, so a page that draws
// no icon downloads none of it.
import { computed, ref, watchEffect } from 'vue';
import { STROKE, type IconName, type IconVariant, type IconWeight } from '../index';

type Shape = [d: string, closed: 0 | 1];

const props = withDefaults(
  defineProps<{
    name?: IconName;
    size?: number | string;
    color?: string;
    variant?: IconVariant;
    weight?: IconWeight;
  }>(),
  { size: 24, variant: 'outline', weight: 'regular' },
);

// On Flutter the tap comes from the widget's own dispatch; here it has to be
// forwarded by hand, so that <icon-mind @tap="…" /> means the same thing on
// both targets.
const emit = defineEmits<{ (e: 'tap'): void }>();

let pending: Promise<Record<string, Shape[]>> | null = null;
const set = ref<Record<string, Shape[]> | null>(null);

function load(): Promise<Record<string, Shape[]>> {
  // through unknown: the file is generated, so there is no type to import
  pending ??= (import('fjs/data/icons.json') as Promise<unknown>).then(
    (m) => ((m as { default?: unknown }).default ?? m) as Record<string, Shape[]>,
  );
  return pending;
}

watchEffect(async () => {
  if (!props.name) return;
  set.value = await load();
});

const shapes = computed<Shape[]>(() => {
  if (!props.name || !set.value) return [];
  const found = set.value[props.name];
  if (!found) console.warn(`[iconmind] no icon named "${props.name}"`);
  return found ?? [];
});

const stroke = computed(() => STROKE[props.weight]);
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    :stroke="color ?? 'currentColor'"
    :stroke-width="stroke"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    @click="emit('tap')"
  >
    <!-- duotone first: a closed shape gets a 20% fill, an open one a 20%
         halo behind the stroke — the same two rules the Dart painter uses -->
    <template v-if="variant === 'duotone'">
      <path
        v-for="(shape, i) in shapes"
        :key="`t${i}`"
        :d="shape[0]"
        :fill="shape[1] ? (color ?? 'currentColor') : 'none'"
        :stroke="shape[1] ? 'none' : undefined"
        :stroke-width="shape[1] ? undefined : stroke + 3"
        opacity="0.2"
      />
    </template>
    <path v-for="(shape, i) in shapes" :key="i" :d="shape[0]" />
  </svg>
</template>
