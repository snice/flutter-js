package dev.flutterjs.flutter_fjs;

import androidx.annotation.NonNull;
import io.flutter.embedding.engine.plugins.FlutterPlugin;

/**
 * flutter_fjs has no platform channels — the JS engine is pure C++ linked
 * into the app and driven via dart:ffi. This class only satisfies the
 * Flutter plugin registration contract.
 */
public class FlutterFjsPlugin implements FlutterPlugin {
    @Override
    public void onAttachedToEngine(@NonNull FlutterPluginBinding binding) {}

    @Override
    public void onDetachedFromEngine(@NonNull FlutterPluginBinding binding) {}
}
