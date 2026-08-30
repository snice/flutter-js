import type { StyleValue } from '@vue/runtime-core';
import '@vue/runtime-core';
import 'vue';

type FjsScalar = string | number | boolean;
type FjsNumberish = number | `${number}`;
type FjsBooleanish = boolean | 'true' | 'false';

interface FjsBaseProps {
  id?: string;
  class?: unknown;
  style?: StyleValue;
  key?: string | number | symbol;
}

interface FjsTapEvents {
  onTap?: () => void;
  onClick?: () => void;
  onLongPress?: () => void;
}

type FjsContainerProps = FjsBaseProps & FjsTapEvents;

interface FjsDefaultSlots {
  default?: () => unknown;
}

type FjsComponent<Props, Slots = FjsDefaultSlots> = {
  new (): {
    $props: Props;
    $slots: Slots;
  };
};

interface FjsImageProps extends FjsContainerProps {
  src?: string;
}

interface FjsButtonProps extends FjsContainerProps {
  disabled?: FjsBooleanish;
}

interface FjsInputProps extends FjsBaseProps {
  value?: FjsScalar;
  placeholder?: string;
  secure?: FjsBooleanish;
  multiline?: FjsBooleanish;
  disabled?: FjsBooleanish;
  keyboard?: 'text' | 'number' | string;
  onInput?: (value: string) => void;
  onSubmit?: (value: string) => void;
  onTextChanged?: (value: string) => void;
}

interface FjsChoiceProps extends FjsBaseProps {
  value?: FjsBooleanish;
  disabled?: FjsBooleanish;
  onChange?: (value: string) => void;
  onValueChanged?: (value: string) => void;
}

interface FjsSliderProps extends FjsBaseProps {
  value?: FjsNumberish;
  min?: FjsNumberish;
  max?: FjsNumberish;
  step?: FjsNumberish;
  disabled?: FjsBooleanish;
  onChange?: (value: string) => void;
  onValueChanged?: (value: string) => void;
}

interface FjsProgressProps extends FjsBaseProps {
  value?: FjsNumberish;
  type?: 'linear' | 'circular' | string;
}

interface FjsSwiperProps extends FjsBaseProps {
  onPageChanged?: (index: string) => void;
}

interface FjsListViewProps<T = unknown> extends FjsContainerProps {
  items?: T[];
  itemHeight?: FjsNumberish;
  preloadExtent?: FjsNumberish;
  prefetchExtent?: FjsNumberish;
  onScroll?: (offset: string) => void;
}

interface FjsListViewSlots<T = unknown> {
  default?: (props: { item: T; index: number }) => unknown;
}

/** Declared as a generic function component (the shape Vue Language Tools
 * keeps generic) so the row slot's `item` follows the element type of
 * `items` instead of collapsing to `unknown`. */
type FjsListViewComponent = <T>(
  props: FjsListViewProps<T>,
  ctx?: unknown,
) => {
  __ctx?: {
    attrs?: unknown;
    slots?: FjsListViewSlots<T>;
    emit?: unknown;
    props?: FjsListViewProps<T>;
    expose?: (exposed: unknown) => void;
  };
};

interface FjsModalProps extends FjsBaseProps {
  visible?: FjsBooleanish;
  onModalClosed?: () => void;
}

interface FjsRefreshProps extends FjsBaseProps {
  onRefresh?: () => void;
}

interface FjsGlobalComponents {
  view: FjsComponent<FjsContainerProps>;
  View: FjsComponent<FjsContainerProps>;
  text: FjsComponent<FjsContainerProps>;
  Text: FjsComponent<FjsContainerProps>;
  image: FjsComponent<FjsImageProps>;
  Image: FjsComponent<FjsImageProps>;
  button: FjsComponent<FjsButtonProps>;
  Button: FjsComponent<FjsButtonProps>;
  input: FjsComponent<FjsInputProps>;
  Input: FjsComponent<FjsInputProps>;
  'scroll-view': FjsComponent<FjsContainerProps>;
  ScrollView: FjsComponent<FjsContainerProps>;
  'list-view': FjsListViewComponent;
  ListView: FjsListViewComponent;
  swiper: FjsComponent<FjsSwiperProps>;
  Swiper: FjsComponent<FjsSwiperProps>;
  stack: FjsComponent<FjsContainerProps>;
  Stack: FjsComponent<FjsContainerProps>;
  'safe-area': FjsComponent<FjsContainerProps>;
  SafeArea: FjsComponent<FjsContainerProps>;
  divider: FjsComponent<FjsBaseProps>;
  Divider: FjsComponent<FjsBaseProps>;
  progress: FjsComponent<FjsProgressProps>;
  Progress: FjsComponent<FjsProgressProps>;
  switch: FjsComponent<FjsChoiceProps>;
  Switch: FjsComponent<FjsChoiceProps>;
  checkbox: FjsComponent<FjsChoiceProps>;
  Checkbox: FjsComponent<FjsChoiceProps>;
  slider: FjsComponent<FjsSliderProps>;
  Slider: FjsComponent<FjsSliderProps>;
  modal: FjsComponent<FjsModalProps>;
  Modal: FjsComponent<FjsModalProps>;
  refresh: FjsComponent<FjsRefreshProps>;
  Refresh: FjsComponent<FjsRefreshProps>;
}

declare module 'vue' {
  export interface GlobalComponents {
    view: FjsGlobalComponents['view'];
    View: FjsGlobalComponents['View'];
    text: FjsGlobalComponents['text'];
    Text: FjsGlobalComponents['Text'];
    image: FjsGlobalComponents['image'];
    Image: FjsGlobalComponents['Image'];
    button: FjsGlobalComponents['button'];
    Button: FjsGlobalComponents['Button'];
    input: FjsGlobalComponents['input'];
    Input: FjsGlobalComponents['Input'];
    'scroll-view': FjsGlobalComponents['scroll-view'];
    ScrollView: FjsGlobalComponents['ScrollView'];
    'list-view': FjsGlobalComponents['list-view'];
    ListView: FjsGlobalComponents['ListView'];
    swiper: FjsGlobalComponents['swiper'];
    Swiper: FjsGlobalComponents['Swiper'];
    stack: FjsGlobalComponents['stack'];
    Stack: FjsGlobalComponents['Stack'];
    'safe-area': FjsGlobalComponents['safe-area'];
    SafeArea: FjsGlobalComponents['SafeArea'];
    divider: FjsGlobalComponents['divider'];
    Divider: FjsGlobalComponents['Divider'];
    progress: FjsGlobalComponents['progress'];
    Progress: FjsGlobalComponents['Progress'];
    switch: FjsGlobalComponents['switch'];
    Switch: FjsGlobalComponents['Switch'];
    checkbox: FjsGlobalComponents['checkbox'];
    Checkbox: FjsGlobalComponents['Checkbox'];
    slider: FjsGlobalComponents['slider'];
    Slider: FjsGlobalComponents['Slider'];
    modal: FjsGlobalComponents['modal'];
    Modal: FjsGlobalComponents['Modal'];
    refresh: FjsGlobalComponents['refresh'];
    Refresh: FjsGlobalComponents['Refresh'];
  }
}

declare module '@vue/runtime-core' {
  export interface GlobalComponents {
    view: FjsGlobalComponents['view'];
    View: FjsGlobalComponents['View'];
    text: FjsGlobalComponents['text'];
    Text: FjsGlobalComponents['Text'];
    image: FjsGlobalComponents['image'];
    Image: FjsGlobalComponents['Image'];
    button: FjsGlobalComponents['button'];
    Button: FjsGlobalComponents['Button'];
    input: FjsGlobalComponents['input'];
    Input: FjsGlobalComponents['Input'];
    'scroll-view': FjsGlobalComponents['scroll-view'];
    ScrollView: FjsGlobalComponents['ScrollView'];
    'list-view': FjsGlobalComponents['list-view'];
    ListView: FjsGlobalComponents['ListView'];
    swiper: FjsGlobalComponents['swiper'];
    Swiper: FjsGlobalComponents['Swiper'];
    stack: FjsGlobalComponents['stack'];
    Stack: FjsGlobalComponents['Stack'];
    'safe-area': FjsGlobalComponents['safe-area'];
    SafeArea: FjsGlobalComponents['SafeArea'];
    divider: FjsGlobalComponents['divider'];
    Divider: FjsGlobalComponents['Divider'];
    progress: FjsGlobalComponents['progress'];
    Progress: FjsGlobalComponents['Progress'];
    switch: FjsGlobalComponents['switch'];
    Switch: FjsGlobalComponents['Switch'];
    checkbox: FjsGlobalComponents['checkbox'];
    Checkbox: FjsGlobalComponents['Checkbox'];
    slider: FjsGlobalComponents['slider'];
    Slider: FjsGlobalComponents['Slider'];
    modal: FjsGlobalComponents['modal'];
    Modal: FjsGlobalComponents['Modal'];
    refresh: FjsGlobalComponents['refresh'];
    Refresh: FjsGlobalComponents['Refresh'];
  }
}

export {};
