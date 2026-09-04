<script setup lang="ts">
// Browser stand-in for the Flutter widget <web-view />. The build registers
// it under that tag, so one template line is a WKWebView on a device and
// this iframe in a browser.
//
// Two things are NOT the same as on the app, and both are the browser's
// doing rather than something left undone (docs/web.md):
//
//   * a cross-origin iframe cannot be injected, so the loaded page brings
//     its own `fjs.postMessage` shim (see public/demo.html) and talks to us
//     through window.postMessage;
//   * `error` on an iframe almost never fires. An HTTP 404 or 500 is a
//     successful load of an error page, and network-level failures are
//     silent. A page that needs to know it loaded should say so itself with
//     fjs.postMessage('ready').
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  errorPayload,
  LoadCycle,
  loadPayload,
  messagePayload,
  resolveSrc,
  classifySrc,
  unsupportedSrcMessage,
} from '../index';
import type { FjsHtmlSrc } from '@ufjs/runtime';

// FjsHtmlSrc, not string: the tag's type comes from this component's props
// (the toolchain reads them through FjsWidgetProps), so this one line is
// what makes <web-view src> complete the project's html/ pages on both
// targets. It still accepts any string — http URLs and asset:// included.
const props = defineProps<{ src?: FjsHtmlSrc }>();

const emit = defineEmits<{
  (e: 'load', payload: string): void;
  (e: 'error', payload: string): void;
  (e: 'message', payload: string): void;
  (e: 'tap'): void;
}>();

const frame = ref<HTMLIFrameElement | null>(null);
const cycle = new LoadCycle();
/** The generation the currently rendered iframe belongs to. */
const generation = ref(cycle.begin());

const warned = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[fjs] ${message}`);
}

/** The URL this iframe should carry, or undefined for "load nothing". */
const url = computed(() => {
  const raw = props.src ?? '';
  const kind = classifySrc(raw);
  if (kind === 'unsupported') {
    warnOnce(`web-view-src:${raw}`, unsupportedSrcMessage(raw));
    return undefined;
  }
  const resolved = resolveSrc(raw, { target: 'web' });
  return resolved.kind === 'url' ? resolved.url : undefined;
});

// A new src is a new load: bump the generation so the old page's load,
// error and messages are dropped instead of reported against the new URL.
watch(
  () => props.src,
  () => {
    generation.value = cycle.begin();
  },
);

/** The element a result came from has to be the one on screen now.
 *
 * A src change replaces the iframe (it is keyed), but the OLD element stays
 * alive long enough to finish loading, and its listener is this same
 * closure. Without this check that stale finish would be reported — against
 * the new URL, which is the one thing it certainly is not. */
const isCurrent = (event: Event) => event.target === frame.value;

const onLoad = (event: Event) => {
  // An iframe with no src fires `load` for about:blank; that is not a page
  // anybody asked for.
  if (!url.value || !isCurrent(event)) return;
  if (cycle.finish(generation.value)) emit('load', loadPayload(url.value));
};

const onError = (event: Event) => {
  if (!url.value || !isCurrent(event)) return;
  if (cycle.finish(generation.value)) emit('error', errorPayload(url.value));
};

/** Double filter. The window's message event is a party line: anything on
 * the page can post to it, and other iframes get their own. A message is
 * this web-view's only when it came from THIS frame's window and carries the
 * shape the shim sends. Everything else is somebody else's traffic, so it is
 * ignored silently — it is not an error. */
function onWindowMessage(event: MessageEvent): void {
  const element = frame.value;
  if (!element || event.source !== element.contentWindow) return;
  const data = event.data as { __fjs?: unknown } | null;
  if (!data || typeof data !== 'object' || typeof data.__fjs !== 'string') return;
  if (!cycle.accepts(generation.value)) return;
  emit('message', messagePayload(data.__fjs));
}

onMounted(() => window.addEventListener('message', onWindowMessage));
onBeforeUnmount(() => window.removeEventListener('message', onWindowMessage));
</script>

<template>
  <iframe
    ref="frame"
    class="fjs-web-view"
    :src="url"
    :key="generation"
    @load="onLoad"
    @error="onError"
    @click="emit('tap')"
  />
</template>

<style>
/* The box is the page's; the content is the loaded page's. Same as the app
   side, which draws no chrome of its own either. */
.fjs-web-view {
  border: 0;
  display: block;
  width: 100%;
  height: 100%;
  background: transparent;
}
</style>
