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
  /** Explicit mode wins over the legacy fit prop. */
  mode?:
    | 'scaleToFill'
    | 'aspectFit'
    | 'aspectFill'
    | 'widthFix'
    | 'heightFix'
    | 'top'
    | 'bottom'
    | 'center'
    | 'left'
    | 'right'
    | 'top left'
    | 'top right'
    | 'bottom left'
    | 'bottom right';
  /** Legacy compatibility prop; ignored when mode is present. */
  fit?: 'fill' | 'contain' | 'cover' | string;
  lazyLoad?: FjsBooleanish;
  onLoad?: (payload: string) => void;
  onError?: (payload: string) => void;
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
  /** 下面四个由 input / textarea 共用的原生 widget 实现，`textarea` 是它们的
   * 规范入口（docs/ui-api.md），但写在 `<input multiline>` 上同样生效。 */
  autoHeight?: FjsBooleanish;
  focus?: FjsBooleanish;
  autoFocus?: FjsBooleanish;
  confirmType?: 'send' | 'search' | 'next' | 'go' | 'done' | 'return';
  /** 只认 color / font-size / font-weight / line-height 四个键。 */
  placeholderStyle?: string;
  /** 行数变化时派一次，载荷是 {"height":n,"lineCount":n}。 */
  onLinechange?: (payload: string) => void;
}

/** 多行输入。是 JS 组件（components/textarea.ts），渲染成 `<input multiline>`，
 * 所以 props 是 input 的子集加上 textarea 自己的默认值（maxlength 默认 140）。 */
interface FjsTextareaProps extends FjsBaseProps, FjsTouchEvents {
  value?: FjsScalar;
  placeholder?: string;
  /** 只认 color / font-size / font-weight / line-height 四个键。 */
  placeholderStyle?: string;
  disabled?: FjsBooleanish;
  /** 超长直接截断；-1 不限。**默认 140**，和 input 的 -1 不同（照小程序）。 */
  maxlength?: FjsNumberish;
  /** 高度跟着内容长，style.height 被忽略。 */
  autoHeight?: FjsBooleanish;
  /** 受控焦点：false → true 抢焦点，true → false 失焦。 */
  focus?: FjsBooleanish;
  autoFocus?: FjsBooleanish;
  /** 键盘右下角按键。`return` 时按键就是换行，不派 @confirm。 */
  confirmType?: 'send' | 'search' | 'next' | 'go' | 'done' | 'return';
  name?: string;
  onInput?: (value: string) => void;
  onTextChanged?: (value: string) => void;
  /** confirm-type != return 时按下确认键；载荷是当前文本。 */
  onConfirm?: (value: string) => void;
  onFocus?: (value: string) => void;
  onBlur?: (value: string) => void;
  /** 载荷 {"height":n,"lineCount":n}，只有行数变化才派。 */
  onLinechange?: (payload: string) => void;
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

/** 页面内滚动容器。方向：`scroll-x` / `scroll-y` 优先，没写时回落到样式键
 * `direction: horizontal`（两者在不同的层，见 docs/ui-api.md）。 */
interface FjsScrollViewProps extends FjsContainerProps {
  scrollX?: FjsBooleanish;
  scrollY?: FjsBooleanish;
  /** 设置滚动位置；受控但不粘手——只有这个值变化时才跳。 */
  scrollTop?: FjsNumberish;
  scrollLeft?: FjsNumberish;
  /** 滚到 id 等于它的子节点。找不到会告警。 */
  scrollIntoView?: string;
  /** 上面两种跳变是否走动画。 */
  scrollWithAnimation?: FjsBooleanish;
  /** 距顶/底多远算触边，默认 50。 */
  upperThreshold?: FjsNumberish;
  lowerThreshold?: FjsNumberish;
  /** 载荷是 `{scrollTop,scrollLeft,scrollHeight,scrollWidth,deltaX,deltaY}`
   * 的 JSON 串，一帧最多一次。 */
  onScroll?: (detail: string) => void;
  /** 进入阈值区时各派一次；待在区里不重复，离开再回来才重派。 */
  onScrolltoupper?: () => void;
  onScrolltolower?: () => void;
}

interface FjsSwiperProps extends FjsContainerProps {
  /** 受控页码；改它就翻过去，动画时长取 `duration`。 */
  current?: FjsNumberish;
  autoplay?: FjsBooleanish;
  /** 自动翻页间隔，默认 5000。 */
  interval?: FjsNumberish;
  /** 滑动动画时长，默认 500。 */
  duration?: FjsNumberish;
  /** 末页翻回首页。`@change` 派的始终是真实索引。 */
  circular?: FjsBooleanish;
  vertical?: FjsBooleanish;
  indicatorDots?: FjsBooleanish;
  indicatorColor?: string;
  indicatorActiveColor?: string;
  /** 索引串。 */
  onChange?: (index: string) => void;
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

/** 页面内嵌的滚轮。只认 <picker-view-column> 子节点，其它节点不渲染（会告警）。 */
interface FjsPickerViewProps extends FjsContainerProps {
  /** 每列选中项的下标；越界取该列最后一项。 */
  value?: number[];
  /** 中间选中框的样式，支持 height / border / background-color。 */
  indicatorStyle?: string;
  /** 行高，默认 44。两端同值。 */
  itemHeight?: FjsNumberish;
  /** 载荷是下标数组的 JSON 串，如 `[0,2]`；滚动停下才派发。 */
  onChange?: (value: string) => void;
  onValueChanged?: (value: string) => void;
}

type FjsPickerMode = 'selector' | 'multiSelector' | 'time' | 'date';

/** 从底部弹起的选择器。插槽内容就是页面上那一行，点它弹出。
 *
 * 这是个 JS 组件（components/picker.ts），不是 Dart 标签：弹层开合、列生成、
 * 值换算都是编排（宪法 VII）。 */
interface FjsPickerProps extends FjsContainerProps {
  mode?: FjsPickerMode;
  /** selector 的下标 / multiSelector 的下标数组 / time 的 "hh:mm" /
   * date 的 "YYYY-MM-DD"。 */
  value?: FjsNumberish | number[] | string;
  /** selector 是一维、multiSelector 是二维；对象数组配 rangeKey 使用。 */
  range?: readonly unknown[];
  rangeKey?: string;
  /** time / date 的有效范围。 */
  start?: string;
  end?: string;
  /** date 的粒度。 */
  fields?: 'year' | 'month' | 'day';
  disabled?: FjsBooleanish;
  /** 确定时派发；载荷格式随 mode，见 docs/ui-api.md。 */
  onChange?: (value: string) => void;
  /** 取消或蒙层关闭。 */
  onCancel?: () => void;
  /** multiSelector 某列变化，载荷 `{"column":0,"value":2}`。 */
  onColumnchange?: (value: string) => void;
}

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
  textarea: FjsComponent<FjsTextareaProps>;
  Textarea: FjsComponent<FjsTextareaProps>;
  'scroll-view': FjsComponent<FjsScrollViewProps>;
  ScrollView: FjsComponent<FjsScrollViewProps>;
  'list-view': FjsListViewComponent;
  ListView: FjsListViewComponent;
  swiper: FjsComponent<FjsSwiperProps>;
  Swiper: FjsComponent<FjsSwiperProps>;
  'swiper-item': FjsComponent<FjsContainerProps>;
  SwiperItem: FjsComponent<FjsContainerProps>;
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
  'picker-view': FjsComponent<FjsPickerViewProps>;
  PickerView: FjsComponent<FjsPickerViewProps>;
  'picker-view-column': FjsComponent<FjsContainerProps>;
  PickerViewColumn: FjsComponent<FjsContainerProps>;
  picker: FjsComponent<FjsPickerProps>;
  Picker: FjsComponent<FjsPickerProps>;
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
    textarea: FjsGlobalComponents['textarea'];
    Textarea: FjsGlobalComponents['Textarea'];
    'scroll-view': FjsGlobalComponents['scroll-view'];
    ScrollView: FjsGlobalComponents['ScrollView'];
    'list-view': FjsGlobalComponents['list-view'];
    ListView: FjsGlobalComponents['ListView'];
    swiper: FjsGlobalComponents['swiper'];
    Swiper: FjsGlobalComponents['Swiper'];
    'swiper-item': FjsGlobalComponents['swiper-item'];
    SwiperItem: FjsGlobalComponents['SwiperItem'];
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
    'picker-view': FjsGlobalComponents['picker-view'];
    PickerView: FjsGlobalComponents['PickerView'];
    'picker-view-column': FjsGlobalComponents['picker-view-column'];
    PickerViewColumn: FjsGlobalComponents['PickerViewColumn'];
    picker: FjsGlobalComponents['picker'];
    Picker: FjsGlobalComponents['Picker'];
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
    textarea: FjsGlobalComponents['textarea'];
    Textarea: FjsGlobalComponents['Textarea'];
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
