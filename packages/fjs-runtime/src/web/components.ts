// Web implementations of the fjs built-in tags.
//
// The contract these mirror is flutter_jsc's widget layer (widgets.dart):
// same tag names, same props, and — importantly — the same event payloads.
// Every fjs event crosses the JSI boundary as a string, so `@change` hands
// a page `"1"` / `"0"` on Flutter; the web components emit exactly that,
// which is what lets one page component run unchanged on both platforms.
import {
  Teleport,
  defineComponent,
  h,
  onBeforeUnmount,
  ref,


  type VNode,
} from 'vue';
import { hostAttrs, normalizeStyleValues } from './style';
import { FjsListView } from '../components/list-view';
export { FJS_TAGS } from '../tags';

/** Tags handled here. The SFC compiler is told these are components, not
 * native elements — several of them (`text`, `image`, `switch`) would
 * otherwise compile as SVG/HTML elements. */

// ---- tap / long-press ------------------------------------------------------

const LONG_PRESS_MS = 500;

type Emit = (event: never, ...args: unknown[]) => void;

/** Pointer bindings that reproduce GestureDetector's tap + long press.
 * A fired long press swallows the click that follows it, like Flutter. */
function pressBindings(emit: Emit) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let fired = false;
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return {
    onPointerdown: () => {
      fired = false;
      cancel();
      timer = setTimeout(() => {
        fired = true;
        emit('longPress' as never);
      }, LONG_PRESS_MS);
    },
    onPointerup: cancel,
    onPointercancel: cancel,
    onPointerleave: cancel,
    onClick: (event: MouseEvent) => {
      if (fired) {
        fired = false;
        event.stopPropagation();
        return;
      }
      emit('tap' as never);
    },
  };
}

/** Container-ish tags all share tap/long-press and attr pass-through. */
function container(tag: string, hostTag = tag) {
  return defineComponent({
    name: `Fjs${tag}`,
    inheritAttrs: false,
    emits: ['tap', 'longPress'],
    setup(_props, { attrs, slots, emit }) {
      const press = pressBindings(emit);
      return () => h(hostTag, { ...hostAttrs(attrs), ...press }, slots.default?.());
    },
  });
}

// ---- leaf tags -------------------------------------------------------------

const FjsView = container('view');
const FjsText = container('text');
const FjsStack = container('stack');
const FjsSafeArea = container('safe-area');
const FjsScrollView = container('scroll-view');

const FjsImage = defineComponent({
  name: 'FjsImage',
  inheritAttrs: false,
  props: { src: { type: String, default: '' } },
  emits: ['tap', 'longPress'],
  setup(props, { attrs, emit }) {
    const press = pressBindings(emit);
    return () =>
      h('img', {
        ...hostAttrs(attrs),
        ...press,
        class: ['fjs-image', attrs.class],
        // asset:// is the Flutter asset scheme; on the web the same files
        // are served from the bundle root
        src: props.src.replace(/^asset:\/\//, ''),
      });
  },
});

const FjsButton = defineComponent({
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
          ...hostAttrs(attrs),
          ...press,
          type: 'button',
          disabled: props.disabled,
          class: ['fjs-button', attrs.class],
        },
        slots.default?.(),
      );
  },
});

const FjsDivider = defineComponent({
  name: 'FjsDivider',
  inheritAttrs: false,
  setup(_props, { attrs }) {
    return () => h('divider', { ...hostAttrs(attrs) });
  },
});

// ---- form controls ---------------------------------------------------------

const FjsInput = defineComponent({
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

const FjsSwitch = defineComponent({
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

const FjsCheckbox = defineComponent({
  name: 'FjsCheckbox',
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
        'checkbox',
        {
          ...hostAttrs(attrs),
          class: ['fjs-checkbox', { on: props.value, disabled: props.disabled }, attrs.class],
          role: 'checkbox',
          'aria-checked': String(props.value),
          onClick: toggle,
        },
        props.value ? [h('i', { class: 'fjs-check' })] : [],
      );
  },
});

const FjsSlider = defineComponent({
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

const FjsProgress = defineComponent({
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

// ---- swiper / refresh / modal ----------------------------------------------

const FjsSwiper = defineComponent({
  name: 'FjsSwiper',
  inheritAttrs: false,
  emits: ['pageChanged'],
  setup(_props, { attrs, slots, emit }) {
    const track = ref<HTMLElement | null>(null);
    let last = 0;
    let settle: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      const el = track.value;
      if (!el) return;
      if (settle !== null) clearTimeout(settle);
      // scroll-snap has no "settled" event; debounce like PageView does
      settle = setTimeout(() => {
        const index = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
        if (index === last) return;
        last = index;
        emit('pageChanged', String(index));
      }, 80);
    };
    onBeforeUnmount(() => {
      if (settle !== null) clearTimeout(settle);
    });
    return () =>
      h(
        'swiper',
        { ...hostAttrs(attrs), class: ['fjs-swiper', attrs.class], ref: track, onScroll },
        (slots.default?.() ?? []).map((child: VNode) =>
          h('swiper-item', { class: 'fjs-swiper-item' }, [child]),
        ),
      );
  },
});

const FjsRefresh = defineComponent({
  name: 'FjsRefresh',
  inheritAttrs: false,
  emits: ['refresh'],
  setup(_props, { attrs, slots, emit }) {
    const host = ref<HTMLElement | null>(null);
    const pull = ref(0);
    const busy = ref(false);
    let startY: number | null = null;
    const onTouchstart = (event: TouchEvent) => {
      startY = (host.value?.scrollTop ?? 0) <= 0 ? event.touches[0].clientY : null;
    };
    const onTouchmove = (event: TouchEvent) => {
      if (startY === null || busy.value) return;
      pull.value = Math.max(0, Math.min(80, event.touches[0].clientY - startY));
    };
    const onTouchend = () => {
      if (pull.value >= 60 && !busy.value) {
        busy.value = true;
        emit('refresh');
        // RefreshIndicator hides itself after ~600ms; match that
        setTimeout(() => {
          busy.value = false;
        }, 600);
      }
      pull.value = 0;
      startY = null;
    };
    return () =>
      h(
        'refresh',
        {
          ...hostAttrs(attrs),
          class: ['fjs-refresh', attrs.class],
          ref: host,
          onTouchstart,
          onTouchmove,
          onTouchend,
        },
        [
          h(
            'refresh-hint',
            { class: ['fjs-refresh-hint', { active: busy.value || pull.value > 0 }] },
            busy.value ? '正在刷新…' : pull.value >= 60 ? '松开刷新' : '下拉刷新',
          ),
          ...(slots.default?.() ?? []),
        ],
      );
  },
});

const FjsModal = defineComponent({
  name: 'FjsModal',
  inheritAttrs: false,
  props: { visible: { type: Boolean, default: false } },
  emits: ['modalClosed'],
  setup(props, { attrs, slots, emit }) {
    return () =>
      props.visible
        ? h(Teleport, { to: 'body' }, [
            h('fjs-modal', { class: 'fjs-modal' }, [
              h('fjs-modal-mask', {
                class: 'fjs-modal-mask',
                onClick: () => emit('modalClosed'),
              }),
              h(
                'fjs-modal-sheet',
                { ...hostAttrs(attrs), class: ['fjs-modal-sheet', attrs.class] },
                slots.default?.(),
              ),
            ]),
          ])
        : null;
  },
});

export const fjsComponents: Record<string, unknown> = {
  view: FjsView,
  text: FjsText,
  image: FjsImage,
  button: FjsButton,
  input: FjsInput,
  'scroll-view': FjsScrollView,
  'list-view': FjsListView,
  swiper: FjsSwiper,
  stack: FjsStack,
  'safe-area': FjsSafeArea,
  divider: FjsDivider,
  progress: FjsProgress,
  switch: FjsSwitch,
  checkbox: FjsCheckbox,
  slider: FjsSlider,
  modal: FjsModal,
  refresh: FjsRefresh,
};

export { normalizeStyleValues };
