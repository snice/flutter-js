// `input` tag -> TextField.
import 'package:flutter/material.dart';

import '../ffi.dart' show FjsEvent;
import '../mirror_tree.dart';
import '../render/style.dart';
import 'dispatch.dart';

class FjsInput extends StatefulWidget {
  const FjsInput(
      {required this.node, required this.style, required this.dispatch});

  final MirrorNode node;
  final FjsStyle style;
  final FjsDispatch dispatch;

  @override
  State<FjsInput> createState() => _FjsInputState();
}

class _FjsInputState extends State<FjsInput> {
  late final TextEditingController _controller =
      TextEditingController(text: widget.node.props['value']?.toString() ?? '');

  /// Last value seen in props. JS-managed inputs change this prop; inputs
  /// without a `value` prop keep it stable so user typing is never clobbered.
  String? _lastPropValue;

  @override
  void didUpdateWidget(covariant FjsInput oldWidget) {
    super.didUpdateWidget(oldWidget);
    final hasValue = widget.node.props['value'] != null;
    if (!hasValue) return; // unmanaged input — keep local text
    final value = widget.node.props['value'].toString();
    if (_lastPropValue == null) {
      _lastPropValue = value;
      if (_controller.text.isEmpty && value.isNotEmpty)
        _controller.text = value;
      return;
    }
    if (value != _lastPropValue && value != _controller.text) {
      _lastPropValue = value;
      _controller.text = value;
    }
  }

  @override
  Widget build(BuildContext context) {
    final style = widget.style;
    return TextField(
      controller: _controller,
      obscureText: widget.node.props['secure'] == true,
      maxLines: widget.node.props['multiline'] == true ? null : 1,
      textAlign: style.textAlign ?? TextAlign.start,
      // Sizing follows the web adapter's `.fjs-input`, not Material's: the
      // field inherits the 14px body font, and its box (border, radius,
      // padding, background) is whatever the page's own style says — which
      // decorateNode has already drawn around this widget.
      style: TextStyle(
        color: style.color ?? const Color(0xFF333333),
        fontSize: style.fontSize ?? 14,
        fontWeight: style.fontWeight,
        fontStyle: style.fontStyle,
        fontFamily: style.fontFamily,
        letterSpacing: style.letterSpacing,
        height: style.lineHeightMultiplier ?? 1.4,
        leadingDistribution: TextLeadingDistribution.even,
      ),
      decoration: InputDecoration(
        hintText: widget.node.props['placeholder']?.toString(),
        hintStyle: TextStyle(
          color: const Color(0xFF999999),
          fontSize: style.fontSize ?? 14,
          height: 1.4,
          leadingDistribution: TextLeadingDistribution.even,
        ),
        isDense: true,
        // decorateNode applied the page's padding to the box already; only
        // an unstyled input keeps the stylesheet's own `8px 0`.
        contentPadding: style.padding != null
            ? EdgeInsets.zero
            : const EdgeInsets.symmetric(vertical: 8),
        border: InputBorder.none,
      ),
      onChanged: (text) {
        widget.dispatch(widget.node.id, FjsEvent.textChanged, text: text);
      },
      onSubmitted: (text) {
        widget.dispatch(widget.node.id, FjsEvent.textSubmitted, text: text);
      },
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }
}
