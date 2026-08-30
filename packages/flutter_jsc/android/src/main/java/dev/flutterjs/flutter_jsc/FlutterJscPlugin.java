package dev.flutterjs.flutter_jsc;

import androidx.annotation.NonNull;
import io.flutter.embedding.engine.plugins.FlutterPlugin;

/**
 * flutter_jsc has no platform channels — the JS engine is pure C++ linked
 * into the app and driven via dart:ffi. This class only satisfies the
 * Flutter plugin registration contract.
 */
public class FlutterJscPlugin implements FlutterPlugin {
    @Override
    public void onAttachedToEngine(@NonNull FlutterPluginBinding binding) {}

    @Override
    public void onDetachedFromEngine(@NonNull FlutterPluginBinding binding) {}
}
