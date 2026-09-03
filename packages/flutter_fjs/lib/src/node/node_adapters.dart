import 'package:flutter/material.dart';

import '../ffi.dart' show FjsEvent;
import '../render/decoration.dart';
import '../render/flex.dart';
import '../render/gesture.dart';
import '../widgets/button.dart';
import '../widgets/checkbox.dart';
import '../widgets/image.dart';
import '../widgets/input.dart';
import '../widgets/list_view.dart';
import '../widgets/modal.dart';
import '../widgets/progress.dart';
import '../widgets/scroll_behavior.dart';
import '../widgets/slider.dart';
import '../widgets/switch.dart';
import '../widgets/text.dart';
import 'node_adapter.dart';

const viewNodeAdapter = _ViewNodeAdapter();

const builtInNodeAdapters = <FjsNodeAdapter>[
  viewNodeAdapter,
  _TextNodeAdapter(),
  _ImageNodeAdapter(),
  _ButtonNodeAdapter(),
  _InputNodeAdapter(),
  _ScrollViewNodeAdapter(),
  _ListViewNodeAdapter(),
  _SwitchNodeAdapter(),
  _CheckboxNodeAdapter(),
  _SliderNodeAdapter(),
  _ProgressNodeAdapter(),
  _DividerNodeAdapter(),
  _SafeAreaNodeAdapter(),
  _RefreshNodeAdapter(),
  _SwiperNodeAdapter(),
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
    return buildImage(context.node, context.style);
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
    final active = context.pressed && hasTapEvent(context.node);
    return decorateNode(
      context.style,
      content,
      defaultPadding: fjsButtonDefaultPadding,
      defaultBorderRadius: fjsButtonDefaultBorderRadius,
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
    return ScrollConfiguration(
      behavior: const FjsMouseDragScrollBehavior(),
      child: SingleChildScrollView(
        // Node-scoped storage bucket: a scroller replaced on the JS side
        // starts at the top instead of inheriting the previous one's offset.
        key: PageStorageKey<String>(
          'fjs-scroll-${context.tree.generation}-${context.node.id}',
        ),
        scrollDirection: context.style.scrollDirection,
        // This is the content that scrolls, so page-root growth does not
        // apply inside it.
        //
        // `cull: true` is the one place it belongs: a scroller is the only
        // box whose children are reliably outside the clip, and a Column
        // otherwise paints all of them on every frame. Paint only — layout
        // and hit testing still see every child (render/cull.dart).
        child: buildBox(
          context.style,
          context.buildChildren(),
          context.childNodes,
          cull: true,
        ),
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
    return SizedBox(
      height: context.style.height ?? 200,
      child: ScrollConfiguration(
        behavior: const FjsMouseDragScrollBehavior(),
        child: PageView(
          onPageChanged: (i) => context
              .dispatch(context.node.id, FjsEvent.pageChanged, text: '$i'),
          children: context.buildChildren(),
        ),
      ),
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
      dispatch: context.dispatch,
      children: context.buildChildren(),
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
