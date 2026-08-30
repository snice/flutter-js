// `checkbox` tag -> Material Checkbox.
import 'package:flutter/material.dart';

import '../ffi.dart' show FjsEvent;
import '../mirror_tree.dart';
import 'dispatch.dart';

class FjsCheckbox extends StatefulWidget {
  const FjsCheckbox({required this.node, required this.dispatch});

  final MirrorNode node;
  final FjsDispatch dispatch;

  @override
  State<FjsCheckbox> createState() => _FjsCheckboxState();
}

class _FjsCheckboxState extends State<FjsCheckbox> {
  late bool _value = widget.node.props['value'] == true;
  bool _lastProp = false;

  @override
  void initState() {
    super.initState();
    _lastProp = _value;
  }

  @override
  void didUpdateWidget(covariant FjsCheckbox oldWidget) {
    super.didUpdateWidget(oldWidget);
    final v = widget.node.props['value'] == true;
    if (v != _lastProp) {
      _lastProp = v;
      _value = v;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Checkbox(
      value: _value,
      onChanged: widget.node.props['disabled'] == true
          ? null
          : (v) {
              setState(() => _value = v == true);
              widget.dispatch(widget.node.id, FjsEvent.valueChanged,
                  text: v == true ? '1' : '0');
            },
    );
  }
}
