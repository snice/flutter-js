// fjs run — ensure a Flutter host exists, start fjs dev, then `flutter run`.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildBundle, releaseBuild, type BuildOptions } from './build.js';
import { flutterDir as configuredFlutterDir, isEjected } from './config.js';
import { lanAddresses } from './dev.js';

type Platform = 'android' | 'ios';

interface RunOptions {
  platform: Platform;
  device?: string;
  port: number;
  host: string;
  flutterDir: string;
  release: boolean;
  pages: boolean;
  minify: boolean;
  gz: boolean;
  flutterArgs: string[];
}

export async function runCommand(argv: string[]): Promise<void> {
  const opts = parseRunArgs(argv);
  const root = process.cwd();
  const flutterDir = path.resolve(root, opts.flutterDir);
  // resolved up front: no point building a bundle or starting the dev server
  // when there is nothing to run it on
  const device = resolveDevice(opts.platform, opts.device);

  if (opts.release) {
    const buildOpts: BuildOptions = {
      outDir: 'dist',
      minify: opts.minify,
      bytecode: true,
      pages: opts.pages,
      web: false,
      release: true,
      gz: opts.gz,
      apk: false,
      flutterDir: opts.flutterDir,
      flutterArgs: [],
    };
    const res = await buildBundle(buildOpts);
    releaseBuild(buildOpts, res);
    const args = ['run', '--release', '-d', device.id, ...opts.flutterArgs];
    console.log(`fjs run ${opts.platform} --release — Flutter host: ${path.relative(root, flutterDir)}`);
    const status = spawnSync('flutter', args, {
      cwd: flutterDir,
      stdio: 'inherit',
    }).status;
    process.exit(status ?? 1);
  }

  ensureFlutterHost(flutterDir, projectName(root), !isEjected(root));

  const dev = await startDevServer(opts.port, opts.host);
  const cleanup = () => {
    if (!dev.killed) dev.kill('SIGTERM');
  };
  process.once('exit', cleanup);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      cleanup();
      process.exit(signal === 'SIGINT' ? 130 : 143);
    });
  }

  const target = deviceAddress(opts.platform, opts.port, device);
  const args = ['run', '-d', device.id, `--dart-define=FJS_DEV=${target}`, ...opts.flutterArgs];
  console.log(`fjs run ${opts.platform} — Flutter host: ${path.relative(root, flutterDir)}`);
  console.log(`FJS_DEV=${target}`);
  const status = spawnSync('flutter', args, {
    cwd: flutterDir,
    stdio: 'inherit',
  }).status;
  cleanup();
  process.exit(status ?? 1);
}

function parseRunArgs(argv: string[]): RunOptions {
  const first = argv.shift();
  if (first !== 'android' && first !== 'ios') {
    throw new Error('usage: fjs run <android|ios> [--release] [--minify] [--gz] [--device <id>] [--port <n>] [--flutter-dir <dir>] [-- <flutter args>]');
  }
  const opts: RunOptions = {
    platform: first,
    port: 38900,
    host: '0.0.0.0',
    flutterDir: configuredFlutterDir(),
    release: false,
    pages: true,
    minify: false,
    gz: false,
    flutterArgs: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      opts.flutterArgs = argv.slice(i + 1);
      break;
    }
    if (arg === '--device' || arg === '-d') opts.device = requireValue(argv, ++i, arg);
    else if (arg === '--port') opts.port = Number(requireValue(argv, ++i, arg));
    else if (arg === '--host') opts.host = requireValue(argv, ++i, arg);
    else if (arg === '--flutter-dir') opts.flutterDir = requireValue(argv, ++i, arg);
    else if (arg === '--release') opts.release = true;
    else if (arg === '--minify') opts.minify = true;
    else if (arg === '--gz') opts.gz = true;
    else if (arg === '--pages') opts.pages = true;
    else if (arg === '--no-pages') opts.pages = false;
    else throw new Error(`unknown run option: ${arg}`);
  }
  return opts;
}

/** Creates the host if it is missing, then brings it up to date.
 *
 * `managed` is what `fjs host eject` turns off: a host the user has taken
 * ownership of keeps its own lib/main.dart, pubspec and Gradle edits, and
 * fjs only guarantees the asset directories and `pub get`. The default host
 * under `.fjs` is disposable, so it is regenerated every time. */
export function ensureFlutterHost(dir: string, name: string, managed = true): void {
  const pubspec = path.join(dir, 'pubspec.yaml');
  if (!fs.existsSync(pubspec)) {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    const packageName = dartPackageName(name);
    const result = spawnSync('flutter', ['create', '--platforms=android,ios', '--project-name', packageName, dir], {
      stdio: 'inherit',
    });
    if (result.status !== 0) {
      throw new Error('flutter create failed');
    }
  }
  if (managed) {
    writeHostPubspec(pubspec, name);
    writeHostMain(path.join(dir, 'lib', 'main.dart'), name);
    patchAndroidAbiFilters(path.join(dir, 'android', 'app', 'build.gradle'));
    removeDefaultWidgetTest(dir);
  }
  fs.mkdirSync(path.join(dir, 'assets', 'fjs', 'pages'), { recursive: true });
  const get = spawnSync('flutter', ['pub', 'get'], { cwd: dir, stdio: 'inherit' });
  if (get.status !== 0) throw new Error('flutter pub get failed');
}

const ABI_FILTER_MARKER = '// fjs: honour --target-platform for plugin jniLibs';

// `flutter build apk --target-platform android-arm64` only selects which Flutter
// engine/app libraries are packaged; jniLibs coming from plugin AARs (libfjs.so)
// are still packaged for every ABI. Flutter passes the same value to Gradle as
// `-Ptarget-platform`, so mirror it into `ndk.abiFilters` in the host project.
function patchAndroidAbiFilters(file: string): void {
  if (!fs.existsSync(file)) return;
  const source = fs.readFileSync(file, 'utf8');
  if (source.includes(ABI_FILTER_MARKER)) return;
  const anchor = source.indexOf('defaultConfig {');
  if (anchor < 0) return;
  const insertAt = source.indexOf('\n', anchor) + 1;
  const snippet = `        ${ABI_FILTER_MARKER}
        if (project.hasProperty("target-platform")) {
            def fjsAbis = [
                "android-arm": "armeabi-v7a",
                "android-arm64": "arm64-v8a",
                "android-x64": "x86_64",
                "android-x86": "x86",
            ]
            def fjsSelected = project.property("target-platform").split(",")
                .collect { fjsAbis[it.trim()] }.findAll { it != null }
            if (!fjsSelected.isEmpty()) {
                ndk {
                    abiFilters.clear()
                    abiFilters.addAll(fjsSelected)
                }
            }
        }

`;
  fs.writeFileSync(file, source.slice(0, insertAt) + snippet + source.slice(insertAt));
}

function removeDefaultWidgetTest(dir: string): void {
  fs.rmSync(path.join(dir, 'test', 'widget_test.dart'), { force: true });
}

function writeHostPubspec(pubspec: string, appName: string): void {
  const flutterFjsPath = findFlutterFjsPackage();
  const dependency = flutterFjsPath
    ? `  flutter_fjs:\n    path: ${relativeYamlPath(path.dirname(pubspec), flutterFjsPath)}\n`
    : '  flutter_fjs: ^0.1.0\n';
  fs.writeFileSync(
    pubspec,
    `name: ${dartPackageName(appName)}_host
description: "Generated Flutter host for ${appName}."
publish_to: 'none'
version: 1.0.0+1

environment:
  sdk: ^3.5.4

dependencies:
  flutter:
    sdk: flutter
${dependency}

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^4.0.0

flutter:
  uses-material-design: true
  assets:
    - assets/fjs/
    - assets/fjs/pages/
`,
  );
}

function writeHostMain(file: string, appName: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `import 'dart:convert';
import 'dart:io' show Platform;
import 'dart:typed_data' show ByteData;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_fjs/flutter_fjs.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final engine = FjsEngine();
  engine.onLog = (level, message) => debugPrint('[js:$level] $message');
  engine.host.register('device', (args) => {
        'platform': Platform.operatingSystem,
        'locale': Platform.localeName,
        'args': args,
      });
  const dev = String.fromEnvironment('FJS_DEV');
  if (dev.isNotEmpty) {
    await engine.connectDevString(dev);
  } else {
    await engine.loadReleaseAssets();
  }
  runApp(_FjsHostApp(engine: engine));
}

class _FjsHostApp extends StatelessWidget {
  const _FjsHostApp({required this.engine});

  final FjsEngine engine;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '${escapeDart(appName)}',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(useMaterial3: true, colorSchemeSeed: Colors.indigo),
      home: Scaffold(
        body: FjsApp(
          engine: engine,
          placeholder: const Center(child: CircularProgressIndicator()),
        ),
      ),
    );
  }
}

extension on FjsEngine {
  Future<void> connectDevString(String value) async {
    final uri = Uri.parse(value.contains('://') ? value : 'http://$value');
    final host = uri.host;
    final port = uri.hasPort ? uri.port : 38900;
    if (host.isEmpty) {
      throw ArgumentError('FJS_DEV must be host:port, got "$value"');
    }
    await connectDev(host, port);
  }

  Future<ByteData> _loadFjsAsset(String path) => rootBundle.load(path);

  Future<Map<String, Object?>?> _loadReleaseManifest() async {
    try {
      final data = await rootBundle.loadString('assets/fjs/manifest.json');
      return (jsonDecode(data) as Map).cast<String, Object?>();
    } catch (_) {
      return null;
    }
  }

  Future<ByteData?> _tryLoadFjsAsset(String? path) async {
    if (path == null || path.isEmpty) return null;
    try {
      return await _loadFjsAsset(path);
    } catch (_) {
      return null;
    }
  }

  Future<void> loadReleaseAssets() async {
    final manifest = await _loadReleaseManifest();
    final pages = (manifest?['pages'] as Map?)?.cast<String, Object?>();
    chunkLoader = (chunk) async {
      final path = pages?[chunk]?.toString() ?? 'assets/fjs/pages/$chunk.fjsbundle';
      final data = await _tryLoadFjsAsset(path);
      return data?.toUint8List();
    };
    final shared = await _tryLoadFjsAsset(manifest?['shared']?.toString()) ??
        await _tryLoadFjsAsset('assets/fjs/shared.fjsbundle');
    if (shared != null) {
      addPrelude(shared.toUint8List());
    } else {
      // Single-bundle release, used by the pure TypeScript template.
    }
    final bundlePath = manifest?['bundle']?.toString() ?? 'assets/fjs/bundle.fjsbundle';
    final bundle = await _loadFjsAsset(bundlePath);
    runBundle(bundle.toUint8List());
    startEventLoop();
  }
}
`,
  );
}

async function startDevServer(port: number, host: string): Promise<ChildProcess> {
  const existing = await fjsDevServerRoot(port);
  if (existing === process.cwd()) {
    console.log(`using existing fjs dev server on port ${port}`);
    return { killed: true, kill: () => true } as ChildProcess;
  }
  if (existing) {
    throw new Error(`port ${port} is already used by another fjs dev project: ${existing}`);
  }
  if (await canConnect('127.0.0.1', port)) {
    throw new Error(`port ${port} is already in use by another process`);
  }

  const cli = process.argv[1];
  const child = spawn(process.execPath, [cli, 'dev', '--pages', '--port', String(port), '--host', host, '--no-qr'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  await waitForPort(port, child);
  return child;
}

function fjsDevServerRoot(port: number): Promise<string | null> {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/manifest.json', timeout: 500 },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            const manifest = JSON.parse(body) as { entry?: unknown; root?: unknown };
            resolve(
              res.statusCode === 200 &&
                typeof manifest.entry === 'string' &&
                typeof manifest.root === 'string'
                ? path.resolve(manifest.root)
                : null,
            );
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.on('error', () => resolve(null));
  });
}

function waitForPort(port: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30000;
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (child.exitCode != null) {
        clearInterval(timer);
        reject(new Error(`fjs dev exited with ${child.exitCode}`));
        return;
      }
      canConnect('127.0.0.1', port).then((ok) => {
        if (ok) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() > deadline) {
          clearInterval(timer);
          reject(new Error(`timed out waiting for fjs dev on port ${port}`));
        }
      }, reject);
    }, 200);
  });
}

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(300);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

/** A device row from `flutter devices --machine`. */
export interface FlutterDevice {
  id: string;
  name: string;
  isSupported?: boolean;
  targetPlatform?: string;
  emulator?: boolean;
  sdk?: string;
}

/** Everything `flutter devices` knows, or [] when it could not be asked.
 * "no devices" and "no flutter" are the same answer to every caller here:
 * there is nothing to run on. */
export function listDevices(): FlutterDevice[] {
  const probe = spawnSync('flutter', ['devices', '--machine'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (probe.status !== 0 || !probe.stdout) return [];
  try {
    const parsed: unknown = JSON.parse(probe.stdout);
    return Array.isArray(parsed) ? (parsed as FlutterDevice[]) : [];
  } catch {
    return [];
  }
}

/** The devices `fjs run <platform>` will consider, most preferred first:
 * an emulator/simulator reaches the dev server on a host-local address,
 * while a physical device depends on the LAN being routable. */
export function devicesFor(platform: Platform, devices = listDevices()): FlutterDevice[] {
  return devices
    .filter(
      (d) =>
        d.isSupported !== false &&
        (platform === 'android'
          ? (d.targetPlatform ?? '').startsWith('android')
          : d.targetPlatform === 'ios'),
    )
    .sort((a, b) => Number(b.emulator === true) - Number(a.emulator === true));
}

/** Resolves the `-d` argument for `flutter run`.
 *
 * `flutter run -d ios` does not work: flutter matches -d against a device id or
 * name, and no iOS device is called "ios". So when the caller did not pass
 * --device we ask flutter for the device list and pick one on the requested
 * platform ourselves. */
export function resolveDevice(platform: Platform, explicit?: string): FlutterDevice {
  const devices = listDevices();

  if (explicit) {
    // trust the id the caller gave us even if the listing failed; looking it up
    // only tells us whether FJS_DEV can stay on a host-local address
    return devices.find((d) => d.id === explicit) ?? { id: explicit, name: explicit };
  }

  const onPlatform = devicesFor(platform, devices);

  if (onPlatform.length === 0) {
    const label = platform === 'android' ? 'Android emulator or device' : 'iOS simulator or device';
    throw new Error(
      `no ${platform} device found. Start an ${label} (\`flutter emulators\`, ` +
        `\`open -a Simulator\`), or pass one explicitly:\n` +
        `  fjs run ${platform} -d <device-id>   (\`flutter devices\` lists them)`,
    );
  }

  // devicesFor already put emulators first
  const chosen = onPlatform[0];
  if (onPlatform.length > 1) {
    console.log(
      `fjs: ${onPlatform.length} ${platform} devices found, using ${chosen.name} (${chosen.id})`,
    );
    console.log(`     pass -d <device-id> to pick another`);
  }
  return chosen;
}

/** Where the app should look for `fjs dev`. An emulator reaches the host
 * through a fixed alias; a physical device has to come back over the LAN. */
function deviceAddress(platform: Platform, port: number, device: FlutterDevice): string {
  if (device.emulator === false) {
    const lan = lanAddresses()[0];
    if (lan) return `${lan}:${port}`;
    console.warn('fjs: no LAN address found; a physical device may not reach the dev server');
  }
  if (platform === 'android') return `10.0.2.2:${port}`;
  return `127.0.0.1:${port}`;
}

function findFlutterFjsPackage(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '..', '..', 'flutter_fjs'),
    path.resolve(here, '..', '..', '..', 'packages', 'flutter_fjs'),
    path.resolve(process.cwd(), 'packages', 'flutter_fjs'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'pubspec.yaml'))) return candidate;
  }
  return null;
}

export function projectName(root: string): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { name?: unknown };
    if (typeof pkg.name === 'string' && pkg.name) return pkg.name;
  } catch {
    // directory name fallback
  }
  return path.basename(root);
}

function dartPackageName(name: string): string {
  const safe = name
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  const prefixed = /^[a-z]/.test(safe) ? safe : `fjs_${safe}`;
  return prefixed || 'fjs_app';
}

function relativeYamlPath(from: string, to: string): string {
  let rel = path.relative(from, to).replace(/\\/g, '/');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith('-')) throw new Error(`${flag} needs a value`);
  return value;
}

function escapeDart(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
