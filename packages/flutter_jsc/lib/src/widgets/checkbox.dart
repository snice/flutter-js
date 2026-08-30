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
    // Same box the web adapter's `.fjs-checkbox` draws: a 20px square with a
    // 2px grey outline and 4px corners, filled #007aff with a white check
    // when on. Material would reserve 40px around it and push every row of a
    // list apart, hence the SizedBox and the density overrides.
    return SizedBox.square(
      dimension: 20,
      child: Checkbox(
        value: _value,
        activeColor: const Color(0xFF007AFF),
        checkColor: const Color(0xFFFFFFFF),
        side: const BorderSide(color: Color(0xFFB0B0B0), width: 2),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
        materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
        visualDensity: VisualDensity.compact,
        onChanged: widget.node.props['disabled'] == true
            ? null
            : (v) {
                setState(() => _value = v == true);
                widget.dispatch(widget.node.id, FjsEvent.valueChanged,
                    text: v == true ? '1' : '0');
              },
      ),
    );
  }
}
