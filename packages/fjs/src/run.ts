// fjs run — ensure a Flutter host exists, start fjs dev, then `flutter run`.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildBundle, releaseBuild, type BuildOptions } from './build.js';

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
    const args = ['run', '--release', '-d', opts.device ?? opts.platform, ...opts.flutterArgs];
    console.log(`fjs run ${opts.platform} --release — Flutter host: ${path.relative(root, flutterDir)}`);
    const status = spawnSync('flutter', args, {
      cwd: flutterDir,
      stdio: 'inherit',
    }).status;
    process.exit(status ?? 1);
  }

  ensureFlutterHost(flutterDir, projectName(root));

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

  const target = deviceAddress(opts.platform, opts.port);
  const args = ['run', '-d', opts.device ?? opts.platform, `--dart-define=FJS_DEV=${target}`, ...opts.flutterArgs];
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
    flutterDir: '.fjs/flutter',
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

export function ensureFlutterHost(dir: string, name: string): void {
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
  writeHostPubspec(pubspec, name);
  writeHostMain(path.join(dir, 'lib', 'main.dart'), name);
  removeDefaultWidgetTest(dir);
  fs.mkdirSync(path.join(dir, 'assets', 'fjs', 'pages'), { recursive: true });
  const get = spawnSync('flutter', ['pub', 'get'], { cwd: dir, stdio: 'inherit' });
  if (get.status !== 0) throw new Error('flutter pub get failed');
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

function deviceAddress(platform: Platform, port: number): string {
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
