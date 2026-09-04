// Web implementations of the fjs built-in tags.
//
// The contract these mirror is flutter_fjs's widget layer (widgets.dart):
// same tag names, same props, and — importantly — the same event payloads.
// Every fjs event crosses the JSI boundary as a string, so `@change` hands
// a page `"1"` / `"0"` on Flutter; the web components emit exactly that,
// which is what lets one page component run unchanged on both platforms.
//
// One file per group, with `gestures.ts` holding what they share:
//
//   basic.ts    view / text / stack / safe-area / scroll-view / image /
//               button / divider
//   form.ts     input / switch / checkbox / radio / the two groups /
//               label / form / slider / progress
//   scope.ts    the registry the groups, label and form share (its Dart
//               twin is widgets/control_scope.dart)
//   swiper.ts   swiper
//   overlay.ts  refresh / modal
//   list-view   list-view.ts — the web one is a windowed virtual list; the
//               Flutter renderer mounts ../../components/list-view.ts, which
//               leaves the windowing to ListView.builder.
import { FjsListView } from './list-view';
import {
  FjsButton,
  FjsDivider,
  FjsImage,
  FjsSafeArea,
  FjsScrollView,
  FjsText,
  FjsView,
} from './basic';
import {
  FjsCheckbox,
  FjsCheckboxGroup,
  FjsForm,
  FjsInput,
  FjsLabel,
  FjsProgress,
  FjsRadio,
  FjsRadioGroup,
  FjsSlider,
  FjsSwitch,
} from './form';
import { FjsModal, FjsRefresh } from './overlay';
import { FjsSwiper } from './swiper';
import { normalizeStyleValues } from '../style';

/** Tags handled here. The SFC compiler is told these are components, not
 * native elements — several of them (`text`, `image`, `switch`) would
 * otherwise compile as SVG/HTML elements. */
export { FJS_TAGS } from '../../tags';

export const fjsComponents: Record<string, unknown> = {
  view: FjsView,
  text: FjsText,
  image: FjsImage,
  button: FjsButton,
  input: FjsInput,
  'scroll-view': FjsScrollView,
  'list-view': FjsListView,
  swiper: FjsSwiper,
  'safe-area': FjsSafeArea,
  divider: FjsDivider,
  progress: FjsProgress,
  switch: FjsSwitch,
  checkbox: FjsCheckbox,
  radio: FjsRadio,
  'radio-group': FjsRadioGroup,
  'checkbox-group': FjsCheckboxGroup,
  label: FjsLabel,
  form: FjsForm,
  slider: FjsSlider,
  modal: FjsModal,
  refresh: FjsRefresh,
};

export { normalizeStyleValues };
