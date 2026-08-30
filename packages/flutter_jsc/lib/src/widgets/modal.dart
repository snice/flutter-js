// `modal` tag -> Material bottom sheet.
import 'package:flutter/material.dart';

import '../ffi.dart' show FjsEvent;
import '../mirror_tree.dart';
import 'dispatch.dart';

/// `modal` tag: visible prop drives a bottom sheet built from the node's
/// children (a snapshot at open time — live updates while open are a v1
/// limitation). Flipping `visible` back to false from JS closes the sheet;
/// a native dismissal (drag / barrier tap / back) dispatches
/// FjsEvent.modalClosed so JS can flip it back itself.
class FjsModal extends StatefulWidget {
  const FjsModal({
    required this.node,
    required this.dispatch,
    required this.children,
  });

  final MirrorNode node;
  final FjsDispatch dispatch;
  final List<Widget> children;

  @override
  State<FjsModal> createState() => _FjsModalState();
}

class _FjsModalState extends State<FjsModal> {
  bool _shown = false;

  /// Context of the sheet route's own subtree: popping it is how a JS-side
  /// `visible = false` closes the sheet.
  BuildContext? _sheetContext;

  @override
  void didUpdateWidget(covariant FjsModal oldWidget) {
    super.didUpdateWidget(oldWidget);
    final visible = widget.node.props['visible'] == true;
    if (visible && !_shown) {
      _shown = true;
      WidgetsBinding.instance.addPostFrameCallback((_) => _show());
    } else if (!visible && _shown) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _dismiss());
    }
  }

  /// JS asked for the sheet to go away (a button inside it, or any other
  /// state change that flips `visible`).
  void _dismiss() {
    final ctx = _sheetContext;
    if (!_shown || ctx == null || !ctx.mounted) return;
    _shown = false;
    _sheetContext = null;
    Navigator.of(ctx).pop();
  }

  void _show() {
    showModalBottomSheet<void>(
      context: context,
      builder: (sheetContext) {
        _sheetContext = sheetContext;
        return PopScope(
          canPop: true,
          onPopInvokedWithResult: (didPop, _) {
            if (didPop && _shown) {
              widget.dispatch(widget.node.id, FjsEvent.modalClosed);
              _shown = false;
            }
          },
          child: SafeArea(
            // the sheet is height-capped; scroll rather than overflow when
            // the JS content is taller than the cap
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: widget.children,
              ),
            ),
          ),
        );
      },
    ).then((_) {
      _sheetContext = null;
      if (mounted && _shown) {
        _shown = false;
        widget.dispatch(widget.node.id, FjsEvent.modalClosed);
      }
    });
  }

  @override
  Widget build(BuildContext context) => const SizedBox.shrink();
}
