// view / text / stack / safe-area / scroll-view / image / button / divider.
import { defineComponent, h, ref } from 'vue';
import { hostAttrs } from '../style';
import { container, dragPanBindings, mergeBindings, pressBindings } from './gestures';

export const FjsView = container('view');
export const FjsText = container('text');
export const FjsStack = container('stack');
export const FjsSafeArea = container('safe-area');
export const FjsScrollView = defineComponent({
  name: 'FjsScrollView',
  inheritAttrs: false,
  emits: ['tap', 'longPress'],
  setup(_props, { attrs, slots, emit }) {
    const press = pressBindings(emit);
    const host = ref<HTMLElement | null>(null);
    const pan = dragPanBindings(host);
    return () =>
      h(
        'scroll-view',
        { ...mergeBindings(hostAttrs(attrs), press, pan), ref: host },
        slots.default?.(),
      );
  },
});

export const FjsImage = defineComponent({
  name: 'FjsImage',
  inheritAttrs: false,
  props: { src: { type: String, default: '' } },
  emits: ['tap', 'longPress'],
  setup(props, { attrs, emit }) {
    const press = pressBindings(emit);
    return () =>
      h('img', {
        ...mergeBindings(hostAttrs(attrs), press),
        class: ['fjs-image', attrs.class],
        // asset:// is the Flutter asset scheme; on the web the same files
        // are served from the bundle root
        src: props.src.replace(/^asset:\/\//, ''),
      });
  },
});

export const FjsButton = defineComponent({
  name: 'FjsButton',
  inheritAttrs: false,
  props: { disabled: { type: Boolean, default: false } },
  emits: ['tap', 'longPress'],
  setup(props, { attrs, slots, emit }) {
    const press = pressBindings(emit);
    return () =>
      h(
        'button',
        {
          ...mergeBindings(hostAttrs(attrs), press),
          type: 'button',
          disabled: props.disabled,
          class: ['fjs-button', attrs.class],
        },
        slots.default?.(),
      );
  },
});

export const FjsDivider = defineComponent({
  name: 'FjsDivider',
  inheritAttrs: false,
  setup(_props, { attrs }) {
    return () => h('divider', { ...hostAttrs(attrs) });
  },
});
