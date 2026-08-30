// 扫一扫: read the QR code `fjs dev` draws in the terminal.
//
// Camera frames come from the official `camera` plugin; decoding is zxing2,
// see qr_decode.dart for why that pairing rather than a scanner plugin.
//
// The payload is the string the banner prints (http://192.168.x.x:38900),
// and [DevServer.parse] is what decides whether a code is one of ours. Any
// other QR in view is ignored and the camera keeps looking, which beats
// popping an error for every poster on the wall.
import 'dart:async';
import 'dart:isolate';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';

import 'dev_server.dart';
import 'qr_decode.dart';

/// Pushes the scanner and resolves to the scanned server, or null if the
/// user backed out.
Future<DevServer?> scanDevServer(BuildContext context) {
  return Navigator.of(context).push<DevServer>(
    MaterialPageRoute<DevServer>(builder: (_) => const ScanScreen()),
  );
}

class ScanScreen extends StatefulWidget {
  const ScanScreen({super.key});

  @override
  State<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends State<ScanScreen> {
  /// A decode takes tens of milliseconds and runs off the frame stream, so
  /// frames arriving while one is in flight are dropped rather than queued.
  bool _decoding = false;

  /// Set once a code has been accepted: popping is not instant, and a second
  /// detection would pop the screen underneath this one.
  bool _done = false;

  CameraController? _camera;
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_openCamera());
  }

  @override
  void dispose() {
    // stop the stream before the controller goes: a frame delivered to a
    // disposed controller crashes on both platforms
    final camera = _camera;
    _camera = null;
    if (camera != null) {
      unawaited(() async {
        try {
          if (camera.value.isStreamingImages) await camera.stopImageStream();
        } catch (_) {
          // already stopped, or the platform side is gone
        }
        await camera.dispose();
      }());
    }
    super.dispose();
  }

  Future<void> _openCamera() async {
    try {
      final cameras = await availableCameras();
      if (cameras.isEmpty) throw CameraException('no camera', '没有可用的相机');
      final back = cameras.firstWhere(
        (c) => c.lensDirection == CameraLensDirection.back,
        orElse: () => cameras.first,
      );
      final camera = CameraController(
        back,
        // enough pixels for a terminal QR at arm's length, few enough that a
        // pure-Dart decode stays well under a frame budget
        ResolutionPreset.medium,
        enableAudio: false,
        imageFormatGroup: ImageFormatGroup.yuv420,
      );
      await camera.initialize();
      if (!mounted) {
        await camera.dispose();
        return;
      }
      await camera.startImageStream(_onFrame);
      setState(() => _camera = camera);
    } on CameraException catch (e) {
      if (mounted) setState(() => _error = _explain(e));
    }
  }

  /// The two failures a user can act on, in the words they need.
  String _explain(CameraException e) {
    const denied = {'CameraAccessDenied', 'CameraAccessDeniedWithoutPrompt'};
    if (denied.contains(e.code)) {
      return '没有相机权限。到系统设置里允许 fjs go 使用相机，或者直接输入 fjs dev 打印的地址。';
    }
    return '相机打不开：${e.description ?? e.code}';
  }

  void _onFrame(CameraImage image) {
    if (_decoding || _done || !mounted) return;
    _decoding = true;
    unawaited(_decode(image).whenComplete(() => _decoding = false));
  }

  Future<void> _decode(CameraImage image) async {
    // plane 0 is the luminance plane in every yuv420 layout the plugin
    // produces (3-plane on Android, biplanar NV12 on iOS)
    final plane = image.planes.first;
    final frame = QrFrame(
      bytes: plane.bytes,
      rowStride: plane.bytesPerRow,
      width: image.width,
      height: image.height,
    );
    // off the UI isolate: a full decode is tens of milliseconds and the
    // preview should not stutter while the user is aiming
    final text = await Isolate.run(frame.decode);
    if (text == null || _done || !mounted) return;
    try {
      final server = DevServer.parse(text);
      _done = true;
      Navigator.of(context).pop(server);
    } on FormatException {
      // some other QR code: keep looking
    }
  }

  @override
  Widget build(BuildContext context) {
    final camera = _camera;
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        title: const Text('扫描 fjs dev 二维码'),
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
      ),
      body: Stack(
        fit: StackFit.expand,
        children: [
          if (_error != null)
            _ScanMessage(text: _error!, icon: Icons.no_photography_outlined)
          else if (camera == null)
            const Center(child: CircularProgressIndicator())
          else
            CameraPreview(camera),
          if (_error == null)
            const Align(
              alignment: Alignment.bottomCenter,
              child: Padding(
                padding: EdgeInsets.all(32),
                child: Text(
                  '对准 fjs dev 终端里打印的二维码',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.white70),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _ScanMessage extends StatelessWidget {
  const _ScanMessage({required this.text, required this.icon});

  final String text;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: Colors.black,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, color: Colors.white70, size: 40),
              const SizedBox(height: 16),
              Text(
                text,
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white70),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
