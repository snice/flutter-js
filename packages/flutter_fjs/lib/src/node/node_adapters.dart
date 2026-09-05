import 'package:flutter/material.dart';

import '../ffi.dart' show FjsEvent;
import '../render/decoration.dart';
import '../render/flex.dart';
import '../widgets/button.dart';
import '../widgets/canvas.dart';
import '../widgets/checkbox.dart';
import '../widgets/group.dart';
import '../widgets/image.dart';
import '../widgets/input.dart';
import '../widgets/label.dart';
import '../widgets/list_view.dart';
import '../widgets/modal.dart';
import '../widgets/picker_view.dart';
import '../widgets/progress.dart';
import '../widgets/radio.dart';
import '../widgets/scroll_behavior.dart';
import '../widgets/scroll_view.dart';
import '../widgets/slider.dart';
import '../widgets/swiper.dart';
import '../widgets/switch.dart';
import '../widgets/text.dart';
import 'node_adapter.dart';

const viewNodeAdapter = _ViewNodeAdapter();

const builtInNodeAdapters = <FjsNodeAdapter>[
  viewNodeAdapter,
  _TextNodeAdapter(),
  _ImageNodeAdapter(),
  _CanvasNodeAdapter(),
  _ButtonNodeAdapter(),
  _InputNodeAdapter(),
  _ScrollViewNodeAdapter(),
  _ListViewNodeAdapter(),
  _SwitchNodeAdapter(),
  _CheckboxNodeAdapter(),
  _RadioNodeAdapter(),
  _RadioGroupNodeAdapter(),
  _CheckboxGroupNodeAdapter(),
  _LabelNodeAdapter(),
  _SliderNodeAdapter(),
  _PickerViewNodeAdapter(),
  _PickerViewColumnNodeAdapter(),
  _ProgressNodeAdapter(),
  _DividerNodeAdapter(),
  _SafeAreaNodeAdapter(),
  _RefreshNodeAdapter(),
  _SwiperNodeAdapter(),
  _SwiperItemNodeAdapter(),
  _ModalNodeAdapter(),
];

final builtInNodeAdapterByTag = Map<String, FjsNodeAdapter>.unmodifiable({
  for (final adapter in builtInNodeAdapters) adapter.tag: adapter,
});

class _TextNodeAdapter extends FjsNodeAdapter {
  const _TextNodeAdapter();

  @override
  String get tag => 'text';

  @override
  Widget build(FjsNodeAdapterContext context) {
    return buildText(
      context.node,
      context.style,
      context.buildChildren(),
    );
  }
}

class _ImageNodeAdapter extends FjsNodeAdapter {
  const _ImageNodeAdapter();

  @override
  String get tag => 'image';

  @override
  Widget build(FjsNodeAdapterContext context) {
    return buildImage(context.node, context.style, context.dispatch);
  }
}

/// The drawing surface. `canvas` itself is a JS component that wraps this in
/// a box with an overlay slot (fjs-runtime/src/components/canvas.ts), so the
/// tag that reaches this side is the inner one.
class _CanvasNodeAdapter extends FjsNodeAdapter {
  const _CanvasNodeAdapter();

  @override
  String get tag => 'inner-canvas';

  @override
  Widget build(FjsNodeAdapterContext context) {
    // children are ignored: the DOM treats a canvas' children as fallback
    // content for browsers that cannot render one, and fjs always can
    return buildCanvas(context.node, context.dispatch);
  }
}

class _ButtonNodeAdapter extends FjsNodeAdapter {
  const _ButtonNodeAdapter();

  @override
  String get tag => 'button';

  @override
  Widget build(FjsNodeAdapterContext context) {
    return buildButton(
      context.tree,
      context.node,
      context.style,
      context.dispatch,
    );
  }

  @override
  Widget decorate(FjsNodeAdapterContext context, Widget content) {
    final chrome = fjsButtonChrome(context.node, context.style);
    final active = context.pressed && fjsButtonIsInteractive(context.node);
    return decorateNode(
      context.style,
      content,
      defaultPadding: chrome.padding,
      defaultBorderRadius: fjsButtonDefaultBorderRadius,
      defaultBackgroundColor: chrome.background,
      defaultBorderColor: chrome.border,
      foregroundDecoration:
          fjsButtonForegroundDecoration(context.style, active),
      foregroundKey: active ? fjsButtonPressMaskKey : null,
    );
  }
}

class _InputNodeAdapter extends FjsNodeAdapter {
  const _InputNodeAdapter();

  @override
  String get tag => 'input';

  @override
  Widget build(FjsNodeAdapterContext context) {
    return FjsInput(
      node: context.node,
      style: context.style,
      dispatch: context.dispatch,
    );
  }
}

/// Scroll views already warned about, so the message appears once per node
/// rather than once per frame.
final Set<int> _warnedFatScrollViews = <int>{};

/// Above this many children, a `scroll-view` is the wrong tag.
///
/// Painting the off-screen ones is handled — render/cull.dart skips them —
/// but a `SingleChildScrollView` still holds a plain [Column], so every child
/// is still BUILT and LAID OUT, and a restyle still rebuilds all of them.
/// `list-view` is a `ListView.builder`: the rows outside the viewport cost a
/// mirror node and nothing else. Measured on an iPhone 17 Pro simulator,
/// debug; see docs/performance.md.
const int _fatScrollViewChildren = 200;

class _ScrollViewNodeAdapter extends FjsNodeAdapter {
  const _ScrollViewNodeAdapter();

  @override
  String get tag => 'scroll-view';

  @override
  Widget build(FjsNodeAdapterContext context) {
    assert(() {
      final count = context.childNodes.length;
      if (count >= _fatScrollViewChildren &&
          _warnedFatScrollViews.add(context.node.id)) {
        debugPrint(
          'fjs: <scroll-view> node ${context.node.id} has $count children. '
          'Painting off-screen rows is culled, but a scroll-view still builds '
          'and lays out every one of them. Use <list-view> for a long list — '
          'it only materializes the viewport. (docs/performance.md)',
        );
      }
      return true;
    }());
    return FjsScrollView(
      node: context.node,
      tree: context.tree,
      style: context.style,
      dispatch: context.dispatch,
      // This is the content that scrolls, so page-root growth does not apply
      // inside it.
      //
      // `cull: true` is the one place it belongs: a scroller is the only box
      // whose children are reliably outside the clip, and a Column otherwise
      // paints all of them on every frame. Paint only — layout and hit
      // testing still see every child (render/cull.dart).
      child: buildBox(
        context.style,
        context.buildChildren(),
        context.childNodes,
        cull: true,
      ),
    );
  }
}

class _ListViewNodeAdapter extends FjsNodeAdapter {
  const _ListViewNodeAdapter();

  @override
  String get tag => 'list-view';

  @override
  Widget build(FjsNodeAdapterContext context) {
    return ScrollConfiguration(
      behavior: const FjsMouseDragScrollBehavior(),
      child: FjsListView(
        key: PageStorageKey<String>(
          'fjs-list-${context.tree.generation}-${context.node.id}',
        ),
        node: context.node,
        style: context.style,
        items: context.childNodes,
        buildItem: context.buildNode,
        dispatch: context.dispatch,
      ),
    );
  }
}


class _RadioNodeAdapter extends FjsNodeAdapter {
  const _RadioNodeAdapter();

  @override
  String get tag => 'radio';

  @override
  Widget build(FjsNodeAdapterContext context) {
    return FjsRadio(
      node: context.node,
      dispatch: context.dispatch,
      children: context.buildChildren(),
      childNodes: context.childNodes,
    );
  }
}

/// radio-group / checkbox-group: no chrome of their own, just a control
/// scope around an ordinary box (widgets/group.dart).
class _RadioGroupNodeAdapter extends FjsNodeAdapter {
  const _RadioGroupNodeAdapter();

  @override
  String get tag => 'radio-group';

  @override
  Widget build(FjsNodeAdapterContext context) {
    return FjsControlGroup(
      node: context.node,
      dispatch: context.dispatch,
      multiple: false,
      child: buildBox(
        context.style,
        context.buildChildren(),
        context.childNodes,
      ),
    );
  }
}

class _CheckboxGroupNodeAdapter extends FjsNodeAdapter {
  const _CheckboxGroupNodeAdapter();

  @override
  String get tag => 'checkbox-group';

  @override
  Widget build(FjsNodeAdapterContext context) {
    return FjsControlGroup(
      node: context.node,
      dispatch: context.dispatch,
      multiple: true,
      child: buildBox(
        context.style,
        context.buildChildren(),
        context.childNodes,
      ),
    );
  }
}

class _LabelNodeAdapter extends FjsNodeAdapter {
  const _LabelNodeAdapter();

  @override
  String get tag => 'label';

  @override
  Widget build(FjsNodeAdapterContext context) {
    return FjsLabel(
      node: context.node,
      style: context.style,
      children: context.buildChildren(),
      childNodes: context.childNodes,
    );
  }
}

class _SwitchNodeAdapter extends FjsNodeAdapter {
  const _SwitchNodeAdapter();

  @override
  String get tag => 'switch';

  @override
  Widget build(FjsNodeAdapterContext context) {
    return FjsSwitch(node: context.node, dispatch: context.dispatch);
  }
}

class _CheckboxNodeAdapter extends FjsNodeAdapter {
  const _CheckboxNodeAdapter();

  @override
  String get tag => 'checkbox';

  @override
  Widget build(FjsNodeAdapterContext context) {
    return FjsCheckbox(
      node: context.node,
      dispatch: context.dispatch,
      children: context.buildChildren(),
      childNodes: context.childNodes,
    );
  }
}

class _SliderNodeAdapter extends FjsNodeAdapter {
  const _SliderNodeAdapter();

  @override
  String get tag => 'slider';

  @override
  Widget build(FjsNodeAdapterContext context) {
    return FjsSlider(node: context.node, dispatch: context.dispatch);
  }
}

class _ProgressNodeAdapter extends FjsNodeAdapter {
  const _ProgressNodeAdapter();

  @override
  String get tag => 'progress';

  @override
  Widget build(FjsNodeAdapterContext context) {
    return buildProgress(context.node);
  }
}

class _DividerNodeAdapter extends FjsNodeAdapter {
  const _DividerNodeAdapter();

  @override
  String get tag => 'divider';

  @override
  Widget build(FjsNodeAdapterContext context) {
    // Web: `divider` is a 16px box with a 1px #e0e0e0 rule down the middle.
    return Divider(
      color: context.style.color ?? const Color(0xFFE0E0E0),
      height: context.style.height ?? 16,
      thickness: 1,
    );
  }
}

class _SafeAreaNodeAdapter extends FjsNodeAdapter {
  const _SafeAreaNodeAdapter();

  @override
  String get tag => 'safe-area';

  @override
  Widget build(FjsNodeAdapterContext context) {
    return SafeArea(
      child: buildBox(
        context.style,
        context.buildChildren(),
        context.childNodes,
        growChildren: context.isRoot,
      ),
    );
  }
}

class _RefreshNodeAdapter extends FjsNodeAdapter {
  const _RefreshNodeAdapter();

  @override
  String get tag => 'refresh';

  @override
  Widget build(FjsNodeAdapterContext context) {
    final children = context.buildChildren();
    return RefreshIndicator(
      onRefresh: () async {
        context.dispatch(context.node.id, FjsEvent.refresh);
        await Future<void>.delayed(const Duration(milliseconds: 600));
      },
      child:
          children.isNotEmpty ? children.single : ListView(children: const []),
    );
  }
}

class _SwiperNodeAdapter extends FjsNodeAdapter {
  const _SwiperNodeAdapter();

  @override
  String get tag => 'swiper';

  @override
  Widget build(FjsNodeAdapterContext context) {
    return FjsSwiper(
      node: context.node,
      style: context.style,
      dispatch: context.dispatch,
      pages: context.buildChildren(),
    );
  }
}

/// `swiper-item` has no behaviour of its own — a page is a page whether or
/// not it is wrapped in one (spec 009 Q2 keeps bare children working), so it
/// is a plain container. Registered rather than left to the fallback so it
/// does not read as an unknown tag.
class _SwiperItemNodeAdapter extends FjsNodeAdapter {
  const _SwiperItemNodeAdapter();

  @override
  String get tag => 'swiper-item';

  @override
  Widget build(FjsNodeAdapterContext context) {
    // A page fills the pager. PageView hands the page a tight box, but the
    // box buildBox makes shrink-wraps its column, so the content would sit
    // as a strip at the top; SizedBox.expand restates the tight box and
    // growChildren stretches the content inside it. The web adapter's
    // `swiper-item` / `swiper-item > *` rules say the same thing.
    return SizedBox.expand(
      child: buildBox(
        context.style,
        context.buildChildren(),
        context.childNodes,
        growChildren: true,
      ),
    );
  }
}

class _PickerViewNodeAdapter extends FjsNodeAdapter {
  const _PickerViewNodeAdapter();

  @override
  String get tag => 'picker-view';

  @override
  Widget build(FjsNodeAdapterContext context) {
    return FjsPickerView(
      node: context.node,
      tree: context.tree,
      style: context.style,
      dispatch: context.dispatch,
      // The wheel builds its own rows lazily, so it needs a per-node
      // builder rather than the whole child list up front.
      buildNode: (child) => context.buildNode(context.flutterContext, child),
    );
  }
}

/// A column has no chrome of its own — the wheel above reads its children
/// and lays them out. Reached only when a page puts one outside a
/// <picker-view>, where it should behave like a plain container.
class _PickerViewColumnNodeAdapter extends FjsNodeAdapter {
  const _PickerViewColumnNodeAdapter();

  @override
  String get tag => 'picker-view-column';

  @override
  Widget build(FjsNodeAdapterContext context) {
    return buildBox(
      context.style,
      context.buildChildren(),
      context.childNodes,
    );
  }
}

class _ModalNodeAdapter extends FjsNodeAdapter {
  const _ModalNodeAdapter();

  @override
  String get tag => 'modal';

  @override
  Widget build(FjsNodeAdapterContext context) {
    return FjsModal(
      node: context.node,
      tree: context.tree,
      dispatch: context.dispatch,
      registry: context.registry,
    );
  }
}

class _ViewNodeAdapter extends FjsNodeAdapter {
  const _ViewNodeAdapter();

  @override
  String get tag => 'view';

  @override
  Widget build(FjsNodeAdapterContext context) {
    return buildBox(
      context.style,
      context.buildChildren(),
      context.childNodes,
      growChildren: context.isRoot,
    );
  }
}
