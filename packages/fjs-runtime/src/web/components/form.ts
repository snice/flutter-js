// input / switch / checkbox / slider / progress — the tags whose DOM shape
// differs from the fjs tag (an <input>, a couple of divs) and whose events
// have to come out as the same strings Flutter sends.
import { defineComponent, h } from 'vue';
import { hostAttrs } from '../style';

export const FjsInput = defineComponent({
  name: 'FjsInput',
  inheritAttrs: false,
  props: {
    value: { type: [String, Number], default: '' },
    placeholder: { type: String, default: '' },
    secure: { type: Boolean, default: false },
    multiline: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
    keyboard: { type: String, default: '' },
  },
  // payloads mirror FjsEvent.textChanged / textSubmitted: the raw string
  emits: ['input', 'submit', 'textChanged'],
  setup(props, { attrs, emit }) {
    const onInput = (event: Event) => {
      const text = (event.target as HTMLInputElement).value;
      emit('input', text);
      emit('textChanged', text);
    };
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || props.multiline) return;
      emit('submit', (event.target as HTMLInputElement).value);
    };
    return () =>
      h(props.multiline ? 'textarea' : 'input', {
        ...hostAttrs(attrs),
        class: ['fjs-input', attrs.class],
        value: String(props.value ?? ''),
        placeholder: props.placeholder,
        disabled: props.disabled,
        ...(props.multiline
          ? {}
          : {
              type: props.secure
                ? 'password'
                : props.keyboard === 'number'
                  ? 'number'
                  : 'text',
            }),
        onInput,
        onKeydown,
      });
  },
});

export const FjsSwitch = defineComponent({
  name: 'FjsSwitch',
  inheritAttrs: false,
  props: {
    value: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
  },
  emits: ['change', 'valueChanged'],
  setup(props, { attrs, emit }) {
    const toggle = () => {
      if (props.disabled) return;
      const next = props.value ? '0' : '1';
      emit('change', next);
      emit('valueChanged', next);
    };
    return () =>
      h(
        'switch',
        {
          ...hostAttrs(attrs),
          class: ['fjs-switch', { on: props.value, disabled: props.disabled }, attrs.class],
          role: 'switch',
          'aria-checked': String(props.value),
          onClick: toggle,
        },
        [h('i', { class: 'fjs-switch-knob' })],
      );
  },
});

export const FjsCheckbox = defineComponent({
  name: 'FjsCheckbox',
  inheritAttrs: false,
  props: {
    value: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
  },
  emits: ['change', 'valueChanged'],
  setup(props, { attrs, emit, slots }) {
    const toggle = () => {
      if (props.disabled) return;
      const next = props.value ? '0' : '1';
      emit('change', next);
      emit('valueChanged', next);
    };
    return () => {
      const box = h(
        'i',
        { class: ['fjs-checkbox', { on: props.value }] },
        props.value ? [h('i', { class: 'fjs-check' })] : [],
      );
      return h(
        'checkbox',
        {
          ...hostAttrs(attrs),
          class: [{ disabled: props.disabled }, attrs.class],
          role: 'checkbox',
          'aria-checked': String(props.value),
          onClick: toggle,
        },
        [box, ...(slots.default?.() ?? [])],
      );
    };
  },
});

export const FjsSlider = defineComponent({
  name: 'FjsSlider',
  inheritAttrs: false,
  props: {
    value: { type: Number, default: 0 },
    min: { type: Number, default: 0 },
    max: { type: Number, default: 100 },
    step: { type: Number, default: 0 },
    disabled: { type: Boolean, default: false },
  },
  emits: ['change', 'valueChanged'],
  setup(props, { attrs, emit }) {
    const onInput = (event: Event) => {
      // Flutter sends the value with two decimals; keep the string shape
      const raw = Number((event.target as HTMLInputElement).value);
      const text = raw.toFixed(2);
      emit('change', text);
      emit('valueChanged', text);
    };
    return () =>
      h('input', {
        ...hostAttrs(attrs),
        class: ['fjs-slider', attrs.class],
        type: 'range',
        min: props.min,
        max: props.max,
        step: props.step > 0 ? props.step : 'any',
        value: props.value,
        disabled: props.disabled,
        onInput,
      });
  },
});

export const FjsProgress = defineComponent({
  name: 'FjsProgress',
  inheritAttrs: false,
  props: {
    value: { type: Number, default: undefined },
    type: { type: String, default: 'linear' },
  },
  setup(props, { attrs }) {
    return () => {
      if (props.type === 'circular') {
        return h('progress-ring', {
          ...hostAttrs(attrs),
          class: ['fjs-progress-ring', attrs.class],
        });
      }
      const indeterminate = props.value === undefined || props.value === null;
      return h(
        'progress-bar',
        {
          ...hostAttrs(attrs),
          class: ['fjs-progress', { indeterminate }, attrs.class],
        },
        [
          h('i', {
            class: 'fjs-progress-fill',
            style: indeterminate
              ? undefined
              : { width: `${Math.max(0, Math.min(1, props.value as number)) * 100}%` },
          }),
        ],
      );
    };
  },
});
