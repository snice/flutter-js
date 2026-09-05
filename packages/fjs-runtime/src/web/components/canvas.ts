// `inner-canvas` on the web: the drawing surface a real <canvas> provides,
// with two deliberate differences from what a plain <canvas> would give a
// page. The box around it (and its overlay slot) is components/canvas.ts,
// mounted as `canvas` on both platforms.
//
//   1. THE BITMAP FOLLOWS THE BOX. A DOM canvas has a bitmap size (`width`/
//      `height` attributes) independent of its CSS size, and a page that
//      wants crisp output on a retina screen has to set the former to the
//      latter times devicePixelRatio and then scale the context. On Flutter
//      there is no backing store to size — the scene is rasterized at the
//      device ratio — so a page written for fjs never does that arithmetic.
//      To keep one source running on both, this component does it here:
//      backing store = layout size x dpr, with a matching setTransform, so
//      the page's coordinates are logical pixels on both platforms.
//   2. getContext GOES THROUGH THE REGISTRY. '2d' is handed the browser's
//      own context, but 'webgl' returns null here exactly as it does on
//      Flutter. The browser HAS WebGL; returning it would let a page work in
//      dev and paint nothing in the app, which is the failure constitution I
//      is about.
//
// Resizing clears the picture, as it does in any browser (setting the
// backing store size resets the bitmap). The Flutter side drops its retained
// display list on a resize for the same reason — see widgets/canvas.dart.
import { defineComponent, h, onBeforeUnmount, onMounted, ref } from 'vue';

import { resolveContext } from '../../canvas/context-registry';
import { hostAttrs } from '../style';
import { mergeBindings, pressBindings } from './gestures';

export const FjsCanvasSurface = defineComponent({
  name: 'FjsCanvasSurface',
  inheritAttrs: false,
  emits: ['tap', 'longPress', 'resize'],
  setup(_props, { attrs, emit, expose }) {
    const press = pressBindings(emit);
    const el = ref<HTMLCanvasElement | null>(null);
    const contexts = new Map<string, unknown>();
    let observer: ResizeObserver | null = null;
    let logicalWidth = 0;
    let logicalHeight = 0;

    function sync(): void {
      const canvas = el.value;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = globalThis.devicePixelRatio || 1;
      const width = Math.max(0, Math.round(rect.width));
      const height = Math.max(0, Math.round(rect.height));
      if (width === logicalWidth && height === logicalHeight) return;
      logicalWidth = width;
      logicalHeight = height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext('2d');
      // the assignment above already cleared the bitmap; re-establish the
      // logical-pixel coordinate system for whatever draws next
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Same event, same payload as the Flutter side. It matters more there
      // — a canvas has no size until the host lays it out — but emitting it
      // here too is what lets one page draw on `@resize` and work on both.
      emit('resize', `{"width":${width},"height":${height}}`);
    }

    onMounted(() => {
      sync();
      if (typeof ResizeObserver === 'function' && el.value) {
        observer = new ResizeObserver(sync);
        observer.observe(el.value);
      }
    });

    onBeforeUnmount(() => {
      observer?.disconnect();
      observer = null;
    });

    const api = {
      getContext(type: string, attributes?: unknown): unknown {
        const canvas = el.value;
        if (!canvas) return null;
        sync();
        return resolveContext(
          contexts,
          type,
          { canvas: api, domCanvas: canvas },
          attributes,
        );
      },
      toDataURL(type?: string, quality?: number): Promise<string> {
        // a promise, matching the Flutter side's signature: there the pixels
        // do not exist until the host has painted a frame
        const canvas = el.value;
        return Promise.resolve(canvas ? canvas.toDataURL(type, quality) : '');
      },
      get width(): number {
        return logicalWidth;
      },
      get height(): number {
        return logicalHeight;
      },
      /** What the backing store is scaled by, and therefore what a library
       * that resets the context transform has to scale by itself. 1 on
       * Flutter, where the host owns device pixels. */
      get devicePixelRatio(): number {
        return globalThis.devicePixelRatio || 1;
      },
      /** The real element, for code that genuinely needs the DOM node. */
      get element(): HTMLCanvasElement | null {
        return el.value;
      },
    };
    expose(api);

    return () =>
      h(
        'canvas',
        mergeBindings(hostAttrs(attrs), press, { ref: el, class: 'fjs-canvas' }),
      );
  },
});
