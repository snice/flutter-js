// `image` tag -> Image. `src` picks the provider: http(s) is a network image,
// everything else an asset (with or without the `asset://` scheme).
import 'package:flutter/material.dart';

import '../mirror_tree.dart';
import '../render/style.dart';

Widget buildImage(MirrorNode node, FjsStyle style) {
  final src = node.props['src']?.toString() ?? '';
  ImageProvider? provider;
  if (src.startsWith('http://') || src.startsWith('https://')) {
    provider = NetworkImage(src);
  } else if (src.startsWith('asset://')) {
    provider = AssetImage(src.substring('asset://'.length));
  } else if (src.isNotEmpty) {
    provider = AssetImage(src);
  }
  final image = provider != null
      ? Image(image: provider, fit: style.fit ?? BoxFit.cover)
      : const SizedBox();
  return ClipRRect(
    borderRadius: style.borderRadius ?? BorderRadius.zero,
    child: image,
  );
}
