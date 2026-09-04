import type { StyleValue } from '@vue/runtime-core';
import type { FjsTouchEvent } from './ui/touch';
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

/** The DOM touch contract, on every tag that can be touched. Declare
 * `touch-action: none` (or pan-x / pan-y) in the node's style to keep an
 * enclosing scroller from taking the gesture over. */
interface FjsTouchEvents {
  onTouchstart?: (event: FjsTouchEvent) => void;
  onTouchmove?: (event: FjsTouchEvent) => void;
  onTouchend?: (event: FjsTouchEvent) => void;
  onTouchcancel?: (event: FjsTouchEvent) => void;
}

type FjsContainerProps = FjsBaseProps & FjsTapEvents & FjsTouchEvents;

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
  /** default（描边）/ primary / warn；`plain` 是同色描边版。 */
  type?: 'default' | 'primary' | 'warn';
  size?: 'default' | 'mini';
  plain?: FjsBooleanish;
  /** 转圈期间不派发 @tap。 */
  loading?: FjsBooleanish;
  /** 点它就触发最近祖先 <form> 的 submit / reset。 */
  formType?: 'submit' | 'reset';
}

interface FjsInputProps extends FjsBaseProps, FjsTouchEvents {
  value?: FjsScalar;
  placeholder?: string;
  secure?: FjsBooleanish;
  multiline?: FjsBooleanish;
  disabled?: FjsBooleanish;
  keyboard?: 'text' | 'number' | 'decimal' | 'tel' | 'email' | string;
  /** 超长直接截断；-1（默认）不限。 */
  maxlength?: FjsNumberish;
  /** 表单里的字段名，<form> 的 @submit 用它当键。 */
  name?: string;
  onInput?: (value: string) => void;
  onSubmit?: (value: string) => void;
  onTextChanged?: (value: string) => void;
  /** 载荷是当前文本。 */
  onFocus?: (value: string) => void;
  onBlur?: (value: string) => void;
}

/** checkbox / radio / switch：`value` 恒为控件自身的选中态，`name` 是它在
 * <radio-group> / <checkbox-group> / <form> 里的标识。 */
interface FjsChoiceProps extends FjsBaseProps, FjsTouchEvents {
  value?: FjsBooleanish;
  disabled?: FjsBooleanish;
  name?: string;
  onChange?: (value: string) => void;
  onValueChanged?: (value: string) => void;
}

/** radio-group 的 @change 载荷是选中项的 name（无选中为空串）；
 * checkbox-group 的是选中项 name 的 JSON 数组串，按文档顺序。 */
interface FjsGroupProps extends FjsContainerProps {
  name?: string;
  onChange?: (value: string) => void;
  onValueChanged?: (value: string) => void;
}

/** 点 label 区域内任意位置，把点击转给目标控件：有 `for` 找 id 相同的那个，
 * 没有就取子树里第一个控件。checkbox / radio / switch 是切换，input 是聚焦。 */
interface FjsLabelProps extends FjsContainerProps {
  for?: string;
}

/** @submit 载荷是 {name: value} 的 JSON 串，收集子树里所有带 name 的控件；
 * @reset 无载荷，值的回滚由页面做。 */
interface FjsFormProps extends FjsContainerProps {
  onSubmit?: (value: string) => void;
  onReset?: () => void;
}

interface FjsSliderProps extends FjsBaseProps, FjsTouchEvents {
  name?: string;
  value?: FjsNumberish;
  min?: FjsNumberish;
  max?: FjsNumberish;
  step?: FjsNumberish;
  disabled?: FjsBooleanish;
  onChange?: (value: string) => void;
  onValueChanged?: (value: string) => void;
}

interface FjsProgressProps extends FjsBaseProps, FjsTouchEvents {
  value?: FjsNumberish;
  type?: 'linear' | 'circular' | string;
}

interface FjsSwiperProps extends FjsBaseProps, FjsTouchEvents {
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

interface FjsModalProps extends FjsBaseProps, FjsTouchEvents {
  visible?: FjsBooleanish;
  onModalClosed?: () => void;
}

interface FjsRefreshProps extends FjsBaseProps, FjsTouchEvents {
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
  'safe-area': FjsComponent<FjsContainerProps>;
  SafeArea: FjsComponent<FjsContainerProps>;
  divider: FjsComponent<FjsBaseProps & FjsTouchEvents>;
  Divider: FjsComponent<FjsBaseProps & FjsTouchEvents>;
  progress: FjsComponent<FjsProgressProps>;
  Progress: FjsComponent<FjsProgressProps>;
  switch: FjsComponent<FjsChoiceProps>;
  Switch: FjsComponent<FjsChoiceProps>;
  checkbox: FjsComponent<FjsChoiceProps>;
  Checkbox: FjsComponent<FjsChoiceProps>;
  radio: FjsComponent<FjsChoiceProps>;
  Radio: FjsComponent<FjsChoiceProps>;
  'radio-group': FjsComponent<FjsGroupProps>;
  RadioGroup: FjsComponent<FjsGroupProps>;
  'checkbox-group': FjsComponent<FjsGroupProps>;
  CheckboxGroup: FjsComponent<FjsGroupProps>;
  label: FjsComponent<FjsLabelProps>;
  Label: FjsComponent<FjsLabelProps>;
  form: FjsComponent<FjsFormProps>;
  Form: FjsComponent<FjsFormProps>;
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
    radio: FjsGlobalComponents['radio'];
    Radio: FjsGlobalComponents['Radio'];
    'radio-group': FjsGlobalComponents['radio-group'];
    RadioGroup: FjsGlobalComponents['RadioGroup'];
    'checkbox-group': FjsGlobalComponents['checkbox-group'];
    CheckboxGroup: FjsGlobalComponents['CheckboxGroup'];
    label: FjsGlobalComponents['label'];
    Label: FjsGlobalComponents['Label'];
    form: FjsGlobalComponents['form'];
    Form: FjsGlobalComponents['Form'];
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
