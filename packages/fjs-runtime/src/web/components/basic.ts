// view / text / safe-area / scroll-view / image / button / divider.
import {
  computed,
  defineComponent,
  h,
  inject,
  nextTick,
  onMounted,
  onUpdated,
  ref,
} from 'vue';
import { hostAttrs } from '../style';
import { FORM_ACTIONS, warnControlOnce as warnScrollOnce } from './scope';
import {
  DEFAULT_SCROLL_THRESHOLD,
  edgeTransition,
  edgeZone,
  scrollPayload,
  type ScrollEdge,
} from '../../scroll/metrics';
import { container, dragPanBindings, mergeBindings, pressBindings } from './gestures';

export const FjsView = container('view');
export const FjsText = container('text');
export const FjsSafeArea = container('safe-area');
/** A swiper page. No behaviour — but it renders as its own element so the
 * base stylesheet can size a page's content (`swiper-item > *`); mapping it
 * to a plain view would put an unstyled box between the track cell and the
 * content, and the content would collapse to its natural height. */
export const FjsSwiperItem = container('swiper-item');
export const FjsScrollView = defineComponent({
  name: 'FjsScrollView',
  inheritAttrs: false,
  props: {
    /** Direction. These win over the `direction` style key fjs shipped
     * first — different layers, both still valid (spec 009 Q1). */
    scrollX: { type: Boolean, default: false },
    scrollY: { type: Boolean, default: false },
    scrollTop: { type: [Number, String], default: undefined },
    scrollLeft: { type: [Number, String], default: undefined },
    scrollIntoView: { type: String, default: '' },
    scrollWithAnimation: { type: Boolean, default: false },
    upperThreshold: { type: [Number, String], default: DEFAULT_SCROLL_THRESHOLD },
    lowerThreshold: { type: [Number, String], default: DEFAULT_SCROLL_THRESHOLD },
  },
  emits: ['tap', 'longPress', 'scroll', 'scrolltoupper', 'scrolltolower'],
  setup(props, { attrs, slots, emit }) {
    const press = pressBindings(emit);
    const host = ref<HTMLElement | null>(null);
    const pan = dragPanBindings(host);

    const horizontal = () => {
      if (props.scrollX && props.scrollY) {
        warnScrollOnce(
          'scroll-both-axes',
          '<scroll-view> sets both scroll-x and scroll-y; fjs scrolls ' +
            'vertically. Pick one.',
        );
        return false;
      }
      if (props.scrollX) return true;
      if (props.scrollY) return false;
      // fall back to the style key
      return (
        (attrs.style as Record<string, unknown> | undefined)?.direction ===
        'horizontal'
      );
    };

    let edge: ScrollEdge = null;
    let lastReported = 0;
    let scrollQueued = false;
    /** Last position the PAGE asked for; only a change moves the scroller,
     * so a re-render cannot yank a finger-driven scroll back. */
    let lastRequestedOffset: number | undefined;
    let lastRequestedView = '';

    const num = (value: unknown): number | undefined => {
      const n = Number(value);
      return Number.isFinite(n) ? n : undefined;
    };

    const moveTo = (offset: number) => {
      const el = host.value;
      if (!el) return;
      const behavior = props.scrollWithAnimation ? 'smooth' : 'auto';
      if (horizontal()) el.scrollTo({ left: offset, behavior });
      else el.scrollTo({ top: offset, behavior });
    };

    /** Same measurement the Dart side makes: the target's offset inside this
     * scroller, not scrollIntoView() with its own alignment rules. */
    const scrollIntoViewById = (id: string) => {
      const el = host.value;
      if (!el) return;
      const target = el.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
      if (!target) {
        warnScrollOnce(
          `scroll-into-view:${id}`,
          `<scroll-view>: scroll-into-view="${id}" matches no descendant ` +
            'id — nothing scrolled.',
        );
        return;
      }
      const delta = horizontal()
        ? target.getBoundingClientRect().left - el.getBoundingClientRect().left
        : target.getBoundingClientRect().top - el.getBoundingClientRect().top;
      moveTo((horizontal() ? el.scrollLeft : el.scrollTop) + delta);
    };

    const applyProps = () => {
      const target = num(horizontal() ? props.scrollLeft : props.scrollTop);
      if (target !== undefined && target !== lastRequestedOffset) {
        lastRequestedOffset = target;
        moveTo(target);
      }
      if (props.scrollIntoView && props.scrollIntoView !== lastRequestedView) {
        lastRequestedView = props.scrollIntoView;
        scrollIntoViewById(props.scrollIntoView);
      }
    };

    /** Prime, do not report (scroll/metrics.ts): a list that opens at the
     * top is already in the upper zone.
     *
     * Synchronous on mount, NOT deferred to nextTick: a scroll that arrives
     * before the priming ran would be compared against a null state, report
     * its edge, and then be overwritten — the event would look swallowed on
     * whichever platform got there first. */
    const primeEdge = () => {
      const el = host.value;
      const x = horizontal();
      edge = edgeZone({
        offset: (x ? el?.scrollLeft : el?.scrollTop) ?? 0,
        viewport: (x ? el?.clientWidth : el?.clientHeight) ?? 0,
        content: (x ? el?.scrollWidth : el?.scrollHeight) ?? 0,
        upperThreshold: Number(props.upperThreshold) || 0,
        lowerThreshold: Number(props.lowerThreshold) || 0,
      });
    };

    onMounted(() => {
      primeEdge();
      nextTick(applyProps);
    });
    onUpdated(() => nextTick(applyProps));

    const report = () => {
      const el = host.value;
      if (!el) return;
      const x = horizontal();
      const offset = x ? el.scrollLeft : el.scrollTop;

      const step = edgeTransition(edge, {
        offset,
        viewport: x ? el.clientWidth : el.clientHeight,
        content: x ? el.scrollWidth : el.scrollHeight,
        upperThreshold: Number(props.upperThreshold) || 0,
        lowerThreshold: Number(props.lowerThreshold) || 0,
      });
      edge = step.state;
      if (step.emit === 'upper') emit('scrolltoupper');
      if (step.emit === 'lower') emit('scrolltolower');

      const delta = offset - lastReported;
      lastReported = offset;
      emit(
        'scroll',
        scrollPayload({
          scrollTop: x ? 0 : offset,
          scrollLeft: x ? offset : 0,
          scrollHeight: x ? 0 : el.scrollHeight,
          scrollWidth: x ? el.scrollWidth : 0,
          deltaX: x ? delta : 0,
          deltaY: x ? 0 : delta,
        }),
      );
    };

    // One report per frame, the rate Flutter's postFrame queue keeps.
    const onScroll = () => {
      if (scrollQueued) return;
      scrollQueued = true;
      const flush = () => {
        scrollQueued = false;
        report();
      };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush);
      else flush();
    };

    return () =>
      h(
        'scroll-view',
        {
          ...mergeBindings(hostAttrs(attrs), press, pan, { onScroll }),
          ref: host,
        },
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
