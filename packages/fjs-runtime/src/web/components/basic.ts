// view / text / safe-area / scroll-view / image / button / divider.
import { computed, defineComponent, h, inject, ref } from 'vue';
import { hostAttrs } from '../style';
import { FORM_ACTIONS } from './scope';
import { container, dragPanBindings, mergeBindings, pressBindings } from './gestures';

export const FjsView = container('view');
export const FjsText = container('text');
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
  props: {
    disabled: { type: Boolean, default: false },
    /** default (hairline) / primary / warn; `plain` is the outlined one.
     * The numbers behind these live in base-css.ts and, on the other side,
     * in widgets/button.dart. */
    type: { type: String, default: 'default' },
    size: { type: String, default: 'default' },
    plain: { type: Boolean, default: false },
    loading: { type: Boolean, default: false },
    /** submit / reset on the nearest enclosing <form>. */
    formType: { type: String, default: '' },
  },
  emits: ['tap', 'longPress'],
  setup(props, { attrs, slots, emit }) {
    const press = pressBindings(emit);
    const form = inject(FORM_ACTIONS, null);
    // A loading button is inert too — same rule as fjsButtonIsInteractive
    // on the Dart side.
    const inert = computed(() => props.disabled || props.loading);
    const variant = computed(() => {
      const type = props.type === 'primary' || props.type === 'warn'
        ? props.type
        : 'default';
      return [
        `fjs-button--${type}`,
        ...(props.plain ? ['fjs-button--plain'] : []),
        ...(props.size === 'mini' ? ['fjs-button--mini'] : []),
        ...(props.loading ? ['fjs-button--loading'] : []),
      ];
    });
    const onFormType = () => {
      if (inert.value) return;
      if (props.formType === 'submit') form?.submit();
      if (props.formType === 'reset') form?.reset();
    };
    return () =>
      h(
        'button',
        {
          ...mergeBindings(
            hostAttrs(attrs),
            // An inert button must not emit tap or long-press either.
            inert.value ? {} : press,
            { onClick: onFormType },
          ),
          type: 'button',
          // Only `disabled` fades the button (`.fjs-button:disabled`);
          // `loading` is inert without fading, which is what the Dart side
          // does too (widgets/button.dart returns no Opacity for it).
          disabled: props.disabled,
          class: ['fjs-button', ...variant.value, attrs.class],
        },
        props.loading
          ? [h('i', { class: 'fjs-button-spinner' }), slots.default?.()]
          : slots.default?.(),
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
