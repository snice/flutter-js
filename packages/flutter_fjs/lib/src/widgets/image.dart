// `image` tag -> a cached ImageProvider plus the fjs image event contract.
// The provider is used directly so fjs keeps ownership of decoration,
// intrinsic sizing, and node lifecycle.
//
// Three choices worth writing down, all from specs/010-image-mode-events:
//
// * network images go through `CachedNetworkImageProvider` and nothing else.
//   `CachedNetworkImage` the WIDGET would bring its own placeholder, fade and
//   error chrome, which is exactly the layer fjs owns — the page's `mode`,
//   border radius and `@load` / `@error` all live here.
// * lazy-load reuses the renderer's own RenderBox/viewport walk
//   (render/image_visibility.dart) rather than adding `visibility_detector`:
//   the culling code already does this arithmetic, and a second dependency
//   would put lazy timing on a different clock than scroll culling.
// * `mode` wins over the older `fit` prop, and `fit` is read only when no
//   `mode` is set. Pages written before mode existed keep their behavior,
//   at the cost of one prop that has two spellings — see
//   render/image_mode.dart.
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../ffi.dart' show FjsEvent;
import '../mirror_tree.dart' show MirrorNode, fjsBool;
import '../render/image_mode.dart';
import '../render/image_visibility.dart';
import '../render/style.dart';
import 'control_scope.dart' show fjsWarnOnce;
import 'dispatch.dart';

Widget buildImage(
  MirrorNode node,
  FjsStyle style,
  FjsDispatch dispatch,
) {
  return FjsImage(node: node, style: style, dispatch: dispatch);
}

const _imageErrorPayload = '{"errMsg":"image load failed"}';

@visibleForTesting
String fjsImageLoadPayload(int width, int height) =>
    '{"width":$width,"height":$height}';

@visibleForTesting
String fjsImageErrorPayload() => _imageErrorPayload;

@visibleForTesting
ImageProvider<Object> fjsImageProviderForSource(String src) {
  if (src.startsWith('http://') || src.startsWith('https://')) {
    return CachedNetworkImageProvider(src);
  }
  return AssetImage(src);
}

class FjsImage extends StatefulWidget {
  const FjsImage({
    super.key,
    required this.node,
    required this.style,
    required this.dispatch,
    @visibleForTesting this.providerOverride,
  });

  final MirrorNode node;
  final FjsStyle style;
  final FjsDispatch dispatch;
  final ImageProvider<Object>? providerOverride;

  @override
  State<FjsImage> createState() => _FjsImageState();
}

class _FjsImageState extends State<FjsImage> {
  ImageProvider<Object>? _provider;
  ImageStream? _stream;
  ImageStreamListener? _listener;
  FjsImageVisibilityHandle? _visibility;
  String _src = '';
  int _generation = 0;
  bool _started = false;
  bool _terminal = false;
  int? _intrinsicWidth;
  int? _intrinsicHeight;

  bool get _lazy => fjsBool(widget.node.props['lazyLoad']);

  @override
  void initState() {
    super.initState();
    _src = _source();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // ImageProvider resolution reads MediaQuery's device pixel ratio. Waiting
    // until dependencies are established avoids depending on inherited
    // widgets from initState while still starting on the first build pass.
    if (!_started && _visibility == null) _configure();
  }

  @override
  void didUpdateWidget(covariant FjsImage oldWidget) {
    super.didUpdateWidget(oldWidget);
    final nextSrc = _source();
    if (nextSrc != _src) {
      _src = nextSrc;
      _reset();
      _configure();
      return;
    }
    if (!_started && !_lazy) _start();
  }

  String _source() {
    final src = widget.node.props['src']?.toString() ?? '';
    return src.startsWith('asset://') ? src.substring('asset://'.length) : src;
  }

  void _configure() {
    if (_src.isEmpty) return;
    if (_lazy) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted || _started || _visibility != null) return;
        _visibility = registerFjsImageVisibility(
          context,
          _start,
          onFallback: () => fjsWarnOnce(
            'image-lazy-viewport:${widget.node.id}',
            '<image> node ${widget.node.id} uses lazy-load outside a '
                'measurable scroll viewport; loading when attached.',
          ),
        );
      });
    } else {
      _start();
    }
  }

  void _reset() {
    _generation++;
    _terminal = false;
    _started = false;
    _intrinsicWidth = null;
    _intrinsicHeight = null;
    final visibility = _visibility;
    if (visibility != null) unregisterFjsImageVisibility(visibility);
    _visibility = null;
    _detachStream();
    _provider = null;
  }

  void _start() {
    if (!mounted || _started || _src.isEmpty) return;
    final visibility = _visibility;
    if (visibility != null) unregisterFjsImageVisibility(visibility);
    _visibility = null;
    _started = true;
    final generation = _generation;
    _provider = widget.providerOverride ?? fjsImageProviderForSource(_src);
    final stream = _provider!.resolve(createLocalImageConfiguration(context));
    _stream = stream;
    final listener = ImageStreamListener(
      (info, synchronousCall) {
        if (!mounted || generation != _generation || _terminal) return;
        _intrinsicWidth = info.image.width;
        _intrinsicHeight = info.image.height;
        _terminal = true;
        widget.dispatch(
          widget.node.id,
          FjsEvent.imageLoad,
          text: fjsImageLoadPayload(info.image.width, info.image.height),
        );
        setState(() {});
      },
      onError: (Object error, StackTrace? stack) {
        if (!mounted || generation != _generation || _terminal) return;
        _terminal = true;
        widget.dispatch(
          widget.node.id,
          FjsEvent.imageError,
          text: fjsImageErrorPayload(),
        );
        if (resolveFjsImageMode(widget.node, widget.style).fix != null) {
          fjsWarnOnce(
            'image-fix-intrinsic:${widget.node.id}:${_src}',
            '<image> node ${widget.node.id} could not resolve intrinsic '
                'dimensions for ${_src}; using the normal content box.',
          );
        }
        setState(() {});
      },
    );
    _listener = listener;
    stream.addListener(listener);
    if (mounted) setState(() {});
  }

  void _detachStream() {
    final stream = _stream;
    final listener = _listener;
    if (stream != null && listener != null) stream.removeListener(listener);
    _stream = null;
    _listener = null;
  }

  @override
  void dispose() {
    final visibility = _visibility;
    if (visibility != null) unregisterFjsImageVisibility(visibility);
    _detachStream();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!_started || _provider == null) {
      return SizedBox(width: widget.style.width, height: widget.style.height);
    }

    final mode = resolveFjsImageMode(
      widget.node,
      widget.style,
      warn: (message) => fjsWarnOnce(
        'image-mode:${widget.node.id}:${widget.node.props['mode']}',
        message,
      ),
    );
    double? fixedWidth;
    double? fixedHeight;
    if (mode.fix == Axis.horizontal && widget.style.width != null) {
      fixedWidth = widget.style.width;
      fixedHeight = widget.style.width;
    } else if (mode.fix == Axis.vertical && widget.style.height != null) {
      // Before the provider reports intrinsic dimensions, a finite placeholder
      // keeps heightFix safe inside a horizontal Flex. It is replaced with the
      // real aspect ratio below after the image metadata arrives.
      fixedWidth = widget.style.height;
      fixedHeight = widget.style.height;
    }
    if (_intrinsicWidth != null &&
        _intrinsicHeight != null &&
        _intrinsicWidth! > 0 &&
        _intrinsicHeight! > 0) {
      final ratio = _intrinsicWidth! / _intrinsicHeight!;
      if (mode.fix == Axis.horizontal && widget.style.width != null) {
        fixedWidth = widget.style.width;
        fixedHeight = widget.style.width! / ratio;
      } else if (mode.fix == Axis.vertical && widget.style.height != null) {
        fixedWidth = widget.style.height! * ratio;
        fixedHeight = widget.style.height;
      }
    }
    Widget image = Image(
      image: _provider!,
      fit: mode.fit,
      alignment: mode.alignment,
      errorBuilder: (_, __, ___) => const SizedBox.shrink(),
    );
    // A fix mode with an explicit dimension can be resolved to finite bounds.
    // This matters in a horizontal Flex, where an unconstrained image width
    // otherwise becomes Infinity before or during provider resolution.
    if (fixedWidth != null &&
        fixedHeight != null &&
        fixedWidth.isFinite &&
        fixedHeight.isFinite &&
        fixedWidth >= 0 &&
        fixedHeight >= 0) {
      image = SizedBox(
        width: fixedWidth,
        height: fixedHeight,
        child: image,
      );
    }
    // The generic decoration paints a radius but only clips when the page
    // also asks for overflow:hidden. The old image adapter clipped by
    // default, so keep that observable behavior for rounded image content.
    return ClipRRect(
      borderRadius: widget.style.borderRadius ?? BorderRadius.zero,
      child: image,
    );
  }
}
