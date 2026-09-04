// `input` tag -> TextField.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../ffi.dart' show FjsEvent;
import '../mirror_tree.dart';
import '../render/style.dart';
import 'control_scope.dart';
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

class _FjsInputState extends State<FjsInput>
    with FjsControlRegistration<FjsInput> {
  late final TextEditingController _controller =
      TextEditingController(text: widget.node.props['value']?.toString() ?? '');
  late final FocusNode _focusNode = FocusNode()..addListener(_onFocusChange);

  @override
  FjsControlHandle createControlHandle() => FjsControlHandle(
        nodeId: widget.node.id,
        kind: FjsControlKind.input,
        getName: () => widget.node.props['name']?.toString(),
        getId: () => widget.node.props['id']?.toString(),
        // The live text, not the `value` prop: an fjs input may be
        // uncontrolled, and then the prop was never written.
        getValue: () => _controller.text,
        focus: () => _focusNode.requestFocus(),
      );

  /// One event per transition. A FocusNode fires its listener for other
  /// reasons too (focus moving between descendants, the node being
  /// re-parented), and on iOS the keyboard closing, a route push and the
  /// page being torn down all take this path.
  bool _focused = false;

  void _onFocusChange() {
    final has = _focusNode.hasFocus;
    if (has == _focused) return;
    _focused = has;
    widget.dispatch(
      widget.node.id,
      has ? FjsEvent.focus : FjsEvent.blur,
      text: _controller.text,
    );
  }

  /// `-1` (and anything not a positive number) means no limit, as in the
  /// mini-program contract the web adapter also implements.
  int? get _maxLength {
    final raw = widget.node.props['maxlength'];
    final value = raw is num ? raw.toInt() : int.tryParse('${raw ?? ''}');
    return value != null && value > 0 ? value : null;
  }

  TextInputType? get _keyboardType {
    switch (widget.node.props['keyboard']?.toString()) {
      case 'number':
        return TextInputType.number;
      case 'decimal':
        return const TextInputType.numberWithOptions(decimal: true);
      case 'tel':
        return TextInputType.phone;
      case 'email':
        return TextInputType.emailAddress;
      default:
        return fjsBool(widget.node.props['multiline'])
            ? TextInputType.multiline
            : null;
    }
  }

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
    final maxLength = _maxLength;
    return TextField(
      controller: _controller,
      focusNode: _focusNode,
      obscureText: fjsBool(widget.node.props['secure']),
      maxLines: fjsBool(widget.node.props['multiline']) ? null : 1,
      keyboardType: _keyboardType,
      // Truncate silently — Material's own counter/limit UI has no web
      // counterpart, and `maxlength` on an <input> just stops the typing.
      inputFormatters: maxLength == null
          ? null
          : [LengthLimitingTextInputFormatter(maxLength)],
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
    _focusNode.removeListener(_onFocusChange);
    _focusNode.dispose();
    _controller.dispose();
    super.dispose();
  }
}
