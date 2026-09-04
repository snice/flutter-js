// `<textarea>` — a component, not a Dart tag.
//
// Why not a tag: everything textarea adds over `<input multiline>` is either
// a default value (maxlength 140), a name (`@confirm` is `input`'s
// `@submit`), or a gate (`@linechange` only fires on a change). All three
// are organisational — the information is already on this side — which is
// exactly what constitution VII says to keep in JS. Four things genuinely
// needed the native widget and were added to the SHARED input widget
// instead: the internal scroll when `auto-height` is off, the measured line
// count, focus, and the keyboard's confirm key. So `<input multiline
// auto-height>` works too; `textarea` is the documented entry point, not a
// different implementation (docs/ui-api.md).
//
// One factory, two substrates: the Flutter path renders the `input` ELEMENT
// (the custom renderer turns it into widgets/input.dart), the web path
// renders the web adapter's FjsInput COMPONENT. Same props, same defaults,
// same gate — which is the only way "two ends, one contract" survives
// contact with two different render targets.
import {
  defineComponent,
  h,
  type Component,
} from '@vue/runtime-core';
import { LineChangeState, type LineDetail } from '../textarea/lines';
import {
  normalizeConfirmType,
  parsePlaceholderStyle,
  TEXTAREA_DEFAULT_MAXLENGTH,
  UNSUPPORTED_TEXTAREA_PROPS,
} from '../textarea/props';

const warned = new Set<string>();
/** Same warn-once channel the element layer uses, minus the import cycle. */
export function warnTextareaOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[fjs] ${message}`);
}

/** For tests. */
export function resetTextareaWarnOnce(): void {
  warned.clear();
}

export function createFjsTextarea(target: string | Component) {
  return defineComponent({
    name: 'FjsTextarea',
    inheritAttrs: false,
    props: {
      value: { type: [String, Number], default: undefined },
      placeholder: { type: String, default: '' },
      placeholderStyle: { type: String, default: '' },
      disabled: { type: Boolean, default: false },
      /** 140, not input's -1. `-1` still means "no limit". */
      maxlength: {
        type: [Number, String],
        default: TEXTAREA_DEFAULT_MAXLENGTH,
      },
      autoHeight: { type: Boolean, default: false },
      focus: { type: Boolean, default: false },
      autoFocus: { type: Boolean, default: false },
      confirmType: { type: String, default: 'return' },
      name: { type: String, default: '' },
    },
    // payloads mirror the host's: the raw text for everything except
    // linechange, which is the JSON textarea/lines.ts writes
    emits: [
      'input',
      'textChanged',
      'confirm',
      'focus',
      'blur',
      'linechange',
    ],
    setup(props, { attrs, emit }) {
      const lines = new LineChangeState();

      for (const name of UNSUPPORTED_TEXTAREA_PROPS) {
        if (attrs[name] === undefined) continue;
        warnTextareaOnce(
          `textarea-unsupported:${name}`,
          `<textarea> does not implement "${name}" — it is a keyboard or ` +
            'native-webview knob with no counterpart on both platforms ' +
            '(specs/012-textarea §2). The prop is ignored.',
        );
      }

      // `@tap` / `@long-press` are not declared: undeclared listeners stay in
      // attrs and are spread onto the target below. Declaring them would
      // mean installing a tap handler even when the page has none, and on
      // Flutter that alone adds a GestureDetector around the field.
      return () => {
        const confirmType = normalizeConfirmType(props.confirmType, (message) =>
          warnTextareaOnce(`textarea-confirm:${props.confirmType}`, message),
        );
        if (props.focus && props.autoFocus) {
          warnTextareaOnce(
            'textarea-focus-both',
            '<textarea> got both focus and auto-focus; auto-focus is ' +
              'ignored while focus is set.',
          );
        }
        // parsed only to validate: both hosts parse the raw string
        // themselves (widgets/input.dart, web/components/form.ts), but the
        // warning has to fire once, from one place.
        parsePlaceholderStyle(
          props.placeholderStyle,
          (message) =>
            warnTextareaOnce(`textarea-placeholder:${message}`, message),
        );

        return h(target, {
          ...attrs,
          multiline: true,
          ...(props.value === undefined ? {} : { value: props.value }),
          placeholder: props.placeholder,
          placeholderStyle: props.placeholderStyle || undefined,
          disabled: props.disabled,
          maxlength: props.maxlength,
          autoHeight: props.autoHeight,
          focus: props.focus,
          autoFocus: props.autoFocus && !props.focus,
          confirmType,
          name: props.name || undefined,
          onTextChanged: (text: string) => {
            emit('input', text);
            emit('textChanged', text);
          },
          // `@confirm` IS the host's text-submitted event (号 4). The host
          // only sends it when confirm-type is not "return", so there is no
          // filtering to do here.
          onSubmit: (text: string) => emit('confirm', text),
          onFocus: (text: string) => emit('focus', text),
          onBlur: (text: string) => emit('blur', text),
          // The host reports a measurement whenever ITS OWN count changes,
          // including the first one; this gate drops that priming report so
          // both platforms agree that opening a three-line field is not "the
          // line count changed" (textarea/lines.ts).
          onLinechange: (payload: string) => {
            let detail: LineDetail;
            try {
              detail = JSON.parse(payload) as LineDetail;
            } catch {
              return;
            }
            const next = lines.report({
              height: Number(detail.height) || 0,
              lineCount: Number(detail.lineCount) || 0,
            });
            if (next !== null) emit('linechange', next);
          },
        });
      };
    },
  });
}

/** The Flutter path: the `input` element, which the custom renderer turns
 * into widgets/input.dart. */
export const FjsTextarea = createFjsTextarea('input');
