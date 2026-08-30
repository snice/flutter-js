// `switch` tag -> Material Switch.
import 'package:flutter/material.dart';

import '../ffi.dart' show FjsEvent;
import '../mirror_tree.dart';
import 'dispatch.dart';

class FjsSwitch extends StatefulWidget {
  const FjsSwitch({required this.node, required this.dispatch});

  final MirrorNode node;
  final FjsDispatch dispatch;

  @override
  State<FjsSwitch> createState() => _FjsSwitchState();
}

class _FjsSwitchState extends State<FjsSwitch> {
  late bool _value = widget.node.props['value'] == true;
  bool _lastProp = false;

  @override
  void initState() {
    super.initState();
    _lastProp = _value;
  }

  @override
  void didUpdateWidget(covariant FjsSwitch oldWidget) {
    super.didUpdateWidget(oldWidget);
    final v = widget.node.props['value'] == true;
    if (v != _lastProp) {
      _lastProp = v;
      _value = v;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Switch(
      value: _value,
      onChanged: widget.node.props['disabled'] == true
          ? null
          : (v) {
              setState(() => _value = v);
              widget.dispatch(widget.node.id, FjsEvent.valueChanged,
                  text: v ? '1' : '0');
            },
    );
  }
}
