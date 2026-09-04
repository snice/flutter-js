// `modal` tag -> Material bottom sheet.
import 'package:flutter/material.dart';

import '../ffi.dart' show FjsEvent;
import '../mirror_tree.dart';
import '../registry/component.dart';
import '../render/renderer.dart';
import 'dispatch.dart';

/// `modal` tag: visible prop drives a bottom sheet over the node's children.
/// Flipping `visible` back to false from JS closes the sheet; a native
/// dismissal (drag / barrier tap / back) dispatches FjsEvent.modalClosed so
/// JS can flip it back itself — a JS-driven close reports nothing, since JS
/// already knows.
///
/// The sheet mounts a LIVE subtree, not the widgets that existed when it
/// opened. A bottom sheet is its own route and its builder runs once, so
/// handing it a prebuilt list froze the content — `<picker>`'s linked
/// columns (specs/008-picker) could never be replaced mid-scroll. The cost
/// is that the sheet's content rebuilds whenever this node's own child list
/// changes; deeper changes cost nothing extra, because FjsNodeRenderer gives
/// every node its own listener.
/// The sheet's own chrome, matching `.fjs-modal-sheet` in the web base
/// stylesheet — same three numbers on both platforms.
const Color fjsModalSheetBackground = Color(0xFFFFFFFF);
const double fjsModalSheetRadius = 12;
const double fjsModalSheetPadding = 16;

class FjsModal extends StatefulWidget {
  const FjsModal({
    required this.node,
    required this.tree,
    required this.dispatch,
    this.registry,
  });

  final MirrorNode node;
  final MirrorTree tree;
  final FjsDispatch dispatch;
  final ComponentRegistry? registry;

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
      // The web sheet's own chrome (.fjs-modal-sheet in base-css.ts): white,
      // 12px top corners, 16px of padding. Material's defaults are a themed
      // surface tint and 28px corners, which made the same page look like a
      // different component on each platform.
      backgroundColor: fjsModalSheetBackground,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(fjsModalSheetRadius),
        ),
      ),
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
              padding: const EdgeInsets.all(fjsModalSheetPadding),
              child: ListenableBuilder(
                // fires when THIS node's children change; a change deeper
                // down is the business of that node's own listener
                listenable: widget.tree.listenableFor(widget.node.id),
                builder: (_, __) => FjsNodeRenderer(
                  tree: widget.tree,
                  ids: widget.node.children,
                  dispatch: widget.dispatch,
                  registry: widget.registry,
                  // the sheet scrolls, so its height is unbounded — children
                  // must shrink-wrap rather than expand
                  grow: false,
                ),
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
