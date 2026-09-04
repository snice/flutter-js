// fjs run — ensure a Flutter host exists, start fjs dev, then `flutter run`.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildBundle, flutterModeArgs, releaseBuild, type BuildOptions } from '../bundler/build.js';
import {
  autolinkDart,
  autolinkEntries,
  autolinkPubspecDeps,
  moduleDataDir,
  scanModules,
  type AutolinkEntry,
} from '../project/modules.js';
import {
  flutterDir as configuredFlutterDir,
  isEjected,
  readAppConfig,
  type AppConfig,
  type PlistValue,
} from '../project/config.js';
import type { FlutterMode } from '../bundler/build.js';
import { lanAddresses } from '../dev/server.js';

type Platform = 'android' | 'ios';

interface RunOptions {
  platform: Platform;
  device?: string;
  port: number;
  host: string;
  flutterDir: string;
  /** Flutter build mode. 'debug' is the live-editing shape (dev server +
   * JS source); 'profile' and 'release' bake the bytecode assets instead,
   * because an AOT app measured against a dev bundle is measuring the dev
   * path, not the one that ships. */
  mode: FlutterMode;
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

  if (opts.mode !== 'debug') {
    const buildOpts: BuildOptions = {
      outDir: 'dist',
      minify: opts.minify,
      bytecode: true,
      pages: opts.pages,
      web: false,
      release: true,
      mode: opts.mode,
      gz: opts.gz,
      apk: false,
      flutterDir: opts.flutterDir,
      flutterArgs: [],
    };
    const res = await buildBundle(buildOpts);
    releaseBuild(buildOpts, res);
    const args = [
      'run',
      ...flutterModeArgs(opts.mode, opts.flutterArgs),
      '-d',
      device.id,
      ...opts.flutterArgs,
    ];
    console.log(
      `fjs run ${opts.platform} --${opts.mode} — Flutter host: ${path.relative(root, flutterDir)}`,
    );
    const status = spawnSync('flutter', args, {
      cwd: flutterDir,
      stdio: 'inherit',
    }).status;
    process.exit(status ?? 1);
  }

  ensureFlutterHost(flutterDir, projectName(root), !isEjected(root));

  const dev = await startDevServer(opts.port, opts.host);
  const cleanup = () => {
    if (!dev.child.killed) dev.child.kill('SIGTERM');
  };
  process.once('exit', cleanup);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      cleanup();
      process.exit(signal === 'SIGINT' ? 130 : 143);
    });
  }

  const target = deviceAddress(opts.platform, dev.port, device);
  // no --debug: that is `flutter run`'s own default, and passing it would
  // override a `-- --profile` meant as "AOT host, but keep the live JS"
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
    throw new Error(
      'usage: fjs run <android|ios> [--release|--profile] [--no-minify] [--gz] ' +
        '[--device <id>] [--port <n>] [--flutter-dir <dir>] [-- <flutter args>]',
    );
  }
  const opts: RunOptions = {
    platform: first,
    port: 38900,
    host: '0.0.0.0',
    flutterDir: configuredFlutterDir(),
    mode: 'debug',
    pages: true,
    minify: true,
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
    else if (arg === '--release') opts.mode = 'release';
    else if (arg === '--profile') opts.mode = 'profile';
    else if (arg === '--debug') opts.mode = 'debug';
    else if (arg === '--minify') opts.minify = true;
    else if (arg === '--no-minify') opts.minify = false;
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
  // modules with a Flutter side: their pub dependency and their register()
  // call go into the generated host, the way RN autolinks a native module
  const autolink = autolinkEntries(process.cwd());
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
    const appConfig = readAppConfig(process.cwd());
    writeHostPubspec(pubspec, name, autolink);
    writeHostMain(path.join(dir, 'lib', 'main.dart'), name, autolink);
    patchAndroidAbiFilters(path.join(dir, 'android', 'app', 'build.gradle'));
    syncNativeHostConfig(dir, appConfig);
    removeDefaultWidgetTest(dir);
  }
  reportAutolink(autolink, managed);
  fs.mkdirSync(path.join(dir, 'assets', 'fjs', 'pages'), { recursive: true });
  syncModuleAssets(dir);
  const get = spawnSync('flutter', ['pub', 'get'], { cwd: dir, stdio: 'inherit' });
  if (get.status !== 0) throw new Error('flutter pub get failed');
}

/** Copies what the modules' prepare hooks generated into the host's assets.
 *
 * A module's Dart package cannot declare these: they are generated per app,
 * and node_modules is not a place to write. So they ride along as the host's
 * own assets, under a path the module's Dart side knows —
 * `assets/fjs/modules/<name>/<file>`. */
function syncModuleAssets(dir: string): string[] {
  const root = process.cwd();
  const dest = path.join(dir, 'assets', 'fjs', 'modules');
  fs.rmSync(dest, { recursive: true, force: true });
  const names: string[] = [];
  for (const mod of scanModules(root)) {
    const from = moduleDataDir(root, mod.name);
    if (!fs.existsSync(from) || fs.readdirSync(from).length === 0) continue;
    const short = mod.name.replace(/^@[^/]+\//, '');
    // .d.ts files are for the editor, not for the device
    fs.cpSync(from, path.join(dest, short), {
      recursive: true,
      filter: (src) => !src.endsWith('.d.ts'),
    });
    if (fs.readdirSync(path.join(dest, short)).length === 0) {
      fs.rmSync(path.join(dest, short), { recursive: true });
      continue;
    }
    names.push(short);
  }
  return names.sort();
}

/** Every directory under `assets/fjs/public/` that holds a file, as pubspec
 * asset entries.
 *
 * Flutter's asset globs do NOT recurse: `- assets/fjs/public/` picks up the
 * files directly in it and silently ignores `public/images/`. Missing one is
 * not a build error — it is a release build with an image that quietly does
 * not load, which is exactly the failure specs/017-local-image-assets set out
 * to remove, so every level is listed. */
export function publicAssetDirs(dir: string): string[] {
  const rootDir = path.join(dir, 'assets', 'fjs', 'public');
  const found: string[] = [];
  const walk = (abs: string, rel: string): void => {
    const entries = fs.readdirSync(abs, { withFileTypes: true });
    if (entries.some((entry) => entry.isFile())) found.push(rel);
    for (const entry of entries) {
      if (entry.isDirectory()) {
        walk(path.join(abs, entry.name), `${rel}${entry.name}/`);
      }
    }
  };
  if (!fs.existsSync(rootDir)) return found;
  walk(rootDir, 'assets/fjs/public/');
  return found.sort();
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

const ANDROID_CONFIG_START = '    <!-- fjs: configured permissions -->';
const ANDROID_CONFIG_END = '    <!-- fjs: end configured permissions -->';
const PLIST_CONFIG_START = '\t<!-- fjs: configured values -->';
const PLIST_CONFIG_END = '\t<!-- fjs: end configured values -->';

/** Applies only the native declarations owned by app.config.ts. Markers make
 * repeated managed-host generation deterministic while leaving Flutter's
 * generated files and user-owned declarations alone. */
export function syncNativeHostConfig(dir: string, config: AppConfig): void {
  const androidManifest = path.join(dir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
  if (fs.existsSync(androidManifest)) {
    const source = fs.readFileSync(androidManifest, 'utf8');
    const permissions = config.android?.permissions ?? [];
    const block = permissions.length > 0
      ? [
          ANDROID_CONFIG_START,
          ...permissions.map((permission) =>
            `    <uses-permission android:name="${escapeXml(permission)}"/>`,
          ),
          ANDROID_CONFIG_END,
        ].join('\n')
      : '';
    fs.writeFileSync(androidManifest, replaceManagedBlock(
      source,
      ANDROID_CONFIG_START,
      ANDROID_CONFIG_END,
      block,
      '</manifest>',
    ));
  }

  const gradle = gradleFileForHost(dir);
  if (config.android?.applicationId && gradle) {
    const source = fs.readFileSync(gradle, 'utf8');
    const next = source.replace(
      /(applicationId\s*=?\s*)(["'])[^"']+\2/,
      (_match, head: string, quote: string) =>
        `${head}${quote}${config.android!.applicationId}${quote}`,
    );
    if (next !== source) fs.writeFileSync(gradle, next);
  }

  const pbxproj = path.join(dir, 'ios', 'Runner.xcodeproj', 'project.pbxproj');
  if (config.ios?.bundleIdentifier && fs.existsSync(pbxproj)) {
    const source = fs.readFileSync(pbxproj, 'utf8');
    const next = source.replace(
      /(PRODUCT_BUNDLE_IDENTIFIER = )([^;]+)(;)/g,
      (_match, head: string, value: string, tail: string) =>
        `${head}${value.trim().endsWith('.RunnerTests')
          ? `${config.ios!.bundleIdentifier}.RunnerTests`
          : config.ios!.bundleIdentifier}${tail}`,
    );
    if (next !== source) fs.writeFileSync(pbxproj, next);
  }

  const plist = path.join(dir, 'ios', 'Runner', 'Info.plist');
  if (fs.existsSync(plist)) {
    const source = fs.readFileSync(plist, 'utf8');
    const values = config.ios?.infoPlist ?? {};
    const block = Object.keys(values).length > 0
      ? [
          PLIST_CONFIG_START,
          ...Object.entries(values).flatMap(([key, value]) => [
            `\t<key>${escapeXml(key)}</key>`,
            `\t${plistXmlValue(value)}`,
          ]),
          PLIST_CONFIG_END,
        ].join('\n')
      : '';
    fs.writeFileSync(plist, replaceManagedBlock(source, PLIST_CONFIG_START, PLIST_CONFIG_END, block, '</dict>'));
  }
}

function gradleFileForHost(dir: string): string | null {
  return [
    path.join(dir, 'android', 'app', 'build.gradle'),
    path.join(dir, 'android', 'app', 'build.gradle.kts'),
  ].find((file) => fs.existsSync(file)) ?? null;
}

function replaceManagedBlock(
  source: string,
  start: string,
  end: string,
  block: string,
  before: string,
): string {
  let next = source;
  while (true) {
    const startAt = next.indexOf(start);
    if (startAt < 0) break;
    const lineStart = next.lastIndexOf('\n', startAt - 1) + 1;
    const endAt = next.indexOf(end, startAt);
    if (endAt < 0) break;
    const lineEnd = next.indexOf('\n', endAt);
    next = next.slice(0, lineStart) + next.slice(lineEnd < 0 ? next.length : lineEnd + 1);
  }
  if (!block) return next;
  const insertAt = next.lastIndexOf(before);
  if (insertAt < 0) throw new Error(`could not find ${before} while updating Flutter host`);
  const prefix = next.slice(0, insertAt).replace(/\s*$/, '');
  return `${prefix}\n${block}\n${next.slice(insertAt)}`;
}

function plistXmlValue(value: PlistValue): string {
  if (typeof value === 'string') return `<string>${escapeXml(value)}</string>`;
  if (typeof value === 'boolean') return value ? '<true/>' : '<false/>';
  if (typeof value === 'number') return Number.isInteger(value) ? `<integer>${value}</integer>` : `<real>${value}</real>`;
  const entries = value.map((entry) => `\t\t${plistXmlValue(entry)}`).join('\n');
  return `<array>\n${entries}\n\t</array>`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function removeDefaultWidgetTest(dir: string): void {
  fs.rmSync(path.join(dir, 'test', 'widget_test.dart'), { force: true });
}

/** What the autolink did — and, for a host the user owns, what it did not:
 * an ejected host keeps its own pubspec and main.dart, so the two lines a
 * module needs are printed instead of written. */
function reportAutolink(entries: AutolinkEntry[], managed: boolean): void {
  if (entries.length === 0) return;
  if (managed) {
    for (const entry of entries) {
      console.log(`autolink: ${entry.flutter.package} <- module ${entry.module.name}`);
    }
    return;
  }
  console.log('autolink: this host is yours, so fjs did not edit it. It needs:');
  for (const entry of entries) {
    const dep = entry.packageDir
      ? `${entry.flutter.package}: { path: ... }`
      : `${entry.flutter.package}: ${entry.flutter.version}`;
    console.log(`  pubspec.yaml   ${dep}`);
    console.log(`  lib/main.dart  import '${entry.dartImport}';`);
    if (entry.register) console.log(`                 ${entry.register};   // before runApp`);
  }
}

function writeHostPubspec(
  pubspec: string,
  appName: string,
  autolink: AutolinkEntry[] = [],
): void {
  const flutterFjsPath = findFlutterFjsPackage();
  const dependency = flutterFjsPath
    ? `  flutter_fjs:\n    path: ${relativeYamlPath(path.dirname(pubspec), flutterFjsPath)}\n`
    : '  flutter_fjs: ^0.1.0\n';
  const linked = autolinkPubspecDeps(path.dirname(pubspec), autolink);
  // one entry per module directory: Flutter's asset globs are per directory,
  // and an empty one would fail `pub get`
  const moduleAssets = syncModuleAssets(path.dirname(pubspec))
    .map((name) => `    - assets/fjs/modules/${name}/\n`)
    .join('');
  // public/ and the bundler's emitted assets were copied in before this ran
  // (bundler/build.ts syncPublicAssets); list every level, glob is not
  // recursive
  const publicAssets = publicAssetDirs(path.dirname(pubspec))
    .map((rel) => `    - ${rel}\n`)
    .join('');
  // In a checkout the host depends on flutter_fjs by path, while a module's
  // Flutter package depends on the published one — two sources for the same
  // package, which pub refuses. The override says which copy wins, and only
  // exists while both are in play.
  const override =
    flutterFjsPath && autolink.length > 0
      ? `\ndependency_overrides:\n  flutter_fjs:\n    path: ${relativeYamlPath(
          path.dirname(pubspec),
          flutterFjsPath,
        )}\n`
      : '';
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
${dependency}${linked}

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^4.0.0

flutter:
  uses-material-design: true
  assets:
    - assets/fjs/
    - assets/fjs/pages/
${moduleAssets}${publicAssets}${override}`,
  );
}

function writeHostMain(file: string, appName: string, autolink: AutolinkEntry[] = []): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const { imports, registers } = autolinkDart(autolink);
  fs.writeFileSync(
    file,
    `import 'dart:convert';
import 'dart:io' show Platform;
import 'dart:typed_data' show ByteData;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_fjs/flutter_fjs.dart';
${imports}
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final engine = FjsEngine();
  engine.onLog = (level, message) =>
      debugPrint('[js:\${FjsLogLevel.of(level).name}] $message');
  engine.host.register('device', (args) => {
        'platform': Platform.operatingSystem,
        'locale': Platform.localeName,
        'args': args,
      });
${registers}  const dev = String.fromEnvironment('FJS_DEV');
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

export interface DevServerHandle {
  child: ChildProcess;
  port: number;
}

export interface DevPortProbe {
  fjsDevServerRoot(port: number): Promise<string | null>;
  canConnect(host: string, port: number): Promise<boolean>;
}

export interface DevPortSkip {
  port: number;
  reason: string;
}

export interface DevPortSelection {
  port: number;
  reuseExisting: boolean;
  skipped: DevPortSkip[];
}

// Keep the fallback finite so a broken local network stack fails with a useful range.
const DEV_PORT_MAX_ATTEMPTS = 50;

export async function selectDevServerPort(
  requestedPort: number,
  root = process.cwd(),
  probe: DevPortProbe = { fjsDevServerRoot, canConnect },
  maxAttempts = DEV_PORT_MAX_ATTEMPTS,
): Promise<DevPortSelection> {
  const skipped: DevPortSkip[] = [];
  const resolvedRoot = path.resolve(root);
  for (let offset = 0; offset < maxAttempts; offset++) {
    const port = requestedPort + offset;
    const existing = await probe.fjsDevServerRoot(port);
    if (existing && path.resolve(existing) === resolvedRoot) {
      return { port, reuseExisting: true, skipped };
    }
    if (existing) {
      skipped.push({
        port,
        reason: `already used by another fjs dev project: ${existing}`,
      });
      continue;
    }
    if (await probe.canConnect('127.0.0.1', port)) {
      skipped.push({ port, reason: 'already in use by another process' });
      continue;
    }
    return { port, reuseExisting: false, skipped };
  }
  const last = requestedPort + maxAttempts - 1;
  throw new Error(`no free fjs dev port found from ${requestedPort} to ${last}`);
}

async function startDevServer(port: number, host: string): Promise<DevServerHandle> {
  const selection = await selectDevServerPort(port);
  for (const skipped of selection.skipped) {
    console.warn(`fjs: port ${skipped.port} is ${skipped.reason}; trying ${skipped.port + 1}`);
  }
  port = selection.port;
  if (selection.reuseExisting) {
    console.log(`using existing fjs dev server on port ${port}`);
    return { child: { killed: true, kill: () => true } as ChildProcess, port };
  }

  const cli = process.argv[1];
  const child = spawn(process.execPath, [cli, 'dev', '--pages', '--port', String(port), '--host', host, '--no-qr'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  await waitForPort(port, child);
  return { child, port };
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
