// fjs doctor — check that this machine and this project can actually build.
//
// Every check here corresponds to a failure people otherwise hit halfway
// through a build: a missing fjsc, a Flutter host that is not there yet, a
// @ufjs/cli and @ufjs/runtime pair that drifted apart. Checks are grouped
// as ok / warn / fail — warnings are for things only some targets need
// (Xcode on a Linux box is not a problem), failures set the exit code.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findFjsc, fjscPackageName } from './build.js';
import { pagesDir, scanPages } from './pages.js';
import { colorSupported } from './qrcode.js';

type Status = 'ok' | 'warn' | 'fail';

interface Check {
  label: string;
  status: Status;
  detail: string;
  hint?: string;
}

export function doctorCommand(argv: string[]): void {
  for (const arg of argv) throw new Error(`unknown doctor option: ${arg}`);

  const root = process.cwd();
  const checks: Check[] = [
    nodeCheck(),
    projectCheck(root),
    entryCheck(root),
    pagesCheck(root),
    versionCheck(root),
    fjscCheck(),
    flutterCheck(),
    ...platformToolCheck(),
    devicesCheck(),
    hostCheck(root),
  ];

  const color = colorSupported();
  const width = Math.max(...checks.map((c) => c.label.length));
  console.log(`fjs doctor — ${root}\n`);
  for (const check of checks) {
    console.log(`${mark(check.status, color)} ${check.label.padEnd(width)}  ${check.detail}`);
    if (check.hint) {
      for (const line of check.hint.split('\n')) console.log(`  ${dim(line, color)}`);
    }
  }

  const failures = checks.filter((c) => c.status === 'fail').length;
  const warnings = checks.filter((c) => c.status === 'warn').length;
  console.log(
    `\n${checks.length - failures - warnings} ok, ${warnings} warning${
      warnings === 1 ? '' : 's'
    }, ${failures} problem${failures === 1 ? '' : 's'}`,
  );
  if (failures > 0) process.exitCode = 1;
}

// ------------------------------------------------------------- checks

function nodeCheck(): Check {
  const major = Number(process.versions.node.split('.')[0]);
  return major >= 18
    ? { label: 'node', status: 'ok', detail: `v${process.versions.node}` }
    : {
        label: 'node',
        status: 'fail',
        detail: `v${process.versions.node}`,
        hint: 'fjs needs Node 18 or newer',
      };
}

function projectCheck(root: string): Check {
  const pkg = readPackage(root);
  if (!pkg) {
    return {
      label: 'project',
      status: 'warn',
      detail: 'no package.json here',
      hint: 'run fjs from a project root, or create one:\n  npx @ufjs/cli create my-app',
    };
  }
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  if (!deps['@ufjs/cli'] && !deps['@ufjs/runtime']) {
    return {
      label: 'project',
      status: 'warn',
      detail: `${pkg.name ?? path.basename(root)} — no @ufjs dependency`,
      hint: 'this does not look like an fjs project',
    };
  }
  return { label: 'project', status: 'ok', detail: String(pkg.name ?? path.basename(root)) };
}

function entryCheck(root: string): Check {
  const entry = path.join(root, 'src', 'main.ts');
  if (fs.existsSync(entry)) return { label: 'entry', status: 'ok', detail: 'src/main.ts' };
  const alt = ['src/main.js', 'src/index.ts'].find((p) => fs.existsSync(path.join(root, p)));
  if (alt) {
    return {
      label: 'entry',
      status: 'warn',
      detail: `${alt} (not the default)`,
      hint: `pass it explicitly: fjs build ${alt}`,
    };
  }
  return {
    label: 'entry',
    status: 'warn',
    detail: 'no src/main.ts',
    hint: 'fjs build/dev default to src/main.ts',
  };
}

function pagesCheck(root: string): Check {
  const dir = pagesDir(root);
  if (!fs.existsSync(dir)) {
    return {
      label: 'pages',
      status: 'warn',
      detail: 'no src/pages',
      hint: 'file routing is off; fjs create page <name> starts it',
    };
  }
  try {
    const pages = scanPages(root);
    if (pages.length === 0) {
      return { label: 'pages', status: 'warn', detail: 'src/pages is empty' };
    }
    const app = pages.filter((p) => p.platforms.includes('app')).length;
    const web = pages.filter((p) => p.platforms.includes('web')).length;
    return {
      label: 'pages',
      status: 'ok',
      detail: `${pages.length} page${pages.length === 1 ? '' : 's'} (app ${app}, web ${web}) — fjs routes lists them`,
    };
  } catch (e) {
    return {
      label: 'pages',
      status: 'fail',
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

function versionCheck(root: string): Check {
  const cli = installedVersion(root, '@ufjs/cli');
  const runtime = installedVersion(root, '@ufjs/runtime');
  if (!cli && !runtime) {
    return {
      label: 'packages',
      status: 'warn',
      detail: 'nothing installed under node_modules',
      hint: 'run npm install',
    };
  }
  const detail = `@ufjs/cli ${cli ?? 'missing'}, @ufjs/runtime ${runtime ?? 'missing'}`;
  if (!cli || !runtime) {
    return { label: 'packages', status: 'warn', detail, hint: 'run npm install' };
  }
  if (minor(cli) !== minor(runtime)) {
    return {
      label: 'packages',
      status: 'warn',
      detail,
      hint: 'the CLI and the runtime speak one protocol — keep them on the same minor',
    };
  }
  return { label: 'packages', status: 'ok', detail };
}

function fjscCheck(): Check {
  const fjsc = findFjsc();
  if (!fjsc) {
    return {
      label: 'fjsc',
      status: 'warn',
      detail: 'not found',
      hint:
        `bytecode and release builds need it; it normally arrives with ${fjscPackageName()}.\n` +
        'in a repo checkout: node packages/fjsc/build.mjs, then export FJSC_PATH=<binary>',
    };
  }
  const source = process.env.FJSC_PATH && fs.existsSync(process.env.FJSC_PATH)
    ? 'FJSC_PATH'
    : fjsc.includes('node_modules')
      ? 'npm'
      : 'local build';
  return { label: 'fjsc', status: 'ok', detail: `${fjsc} (${source})` };
}

function flutterCheck(): Check {
  const version = firstLine('flutter', ['--version']);
  if (!version) {
    return {
      label: 'flutter',
      status: 'warn',
      detail: 'not on PATH',
      hint: 'only the web build works without it; fjs run/--release need Flutter',
    };
  }
  return { label: 'flutter', status: 'ok', detail: version };
}

function platformToolCheck(): Check[] {
  const checks: Check[] = [];
  const adb = firstLine('adb', ['--version']);
  checks.push(
    adb
      ? { label: 'android', status: 'ok', detail: adb }
      : {
          label: 'android',
          status: 'warn',
          detail: 'adb not on PATH',
          hint: 'needed for Android devices — flutter doctor has the full setup',
        },
  );
  if (process.platform === 'darwin') {
    const xcode = firstLine('xcodebuild', ['-version']);
    checks.push(
      xcode
        ? { label: 'ios', status: 'ok', detail: xcode }
        : {
            label: 'ios',
            status: 'warn',
            detail: 'xcodebuild not available',
            hint: 'install Xcode and run xcode-select --install for iOS builds',
          },
    );
  }
  return checks;
}

function devicesCheck(): Check {
  const probe = spawnSync('flutter', ['devices', '--machine'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 60_000,
  });
  if (probe.status !== 0 || !probe.stdout) {
    return { label: 'devices', status: 'warn', detail: 'could not list (is flutter installed?)' };
  }
  let devices: Array<{ name?: string; id?: string; targetPlatform?: string }> = [];
  try {
    const parsed: unknown = JSON.parse(probe.stdout);
    if (Array.isArray(parsed)) devices = parsed;
  } catch {
    return { label: 'devices', status: 'warn', detail: 'flutter devices returned junk' };
  }
  const mobile = devices.filter((d) => {
    const target = d.targetPlatform ?? '';
    return target.startsWith('android') || target === 'ios';
  });
  if (mobile.length === 0) {
    return {
      label: 'devices',
      status: 'warn',
      detail: 'no android/ios device',
      hint: 'start an emulator (flutter emulators) or a simulator before fjs run',
    };
  }
  return {
    label: 'devices',
    status: 'ok',
    detail: mobile.map((d) => `${d.name} (${d.id})`).join(', '),
  };
}

function hostCheck(root: string): Check {
  const dir = path.join(root, '.fjs', 'flutter');
  const pubspec = path.join(dir, 'pubspec.yaml');
  if (!fs.existsSync(pubspec)) {
    return {
      label: 'flutter host',
      status: 'ok',
      detail: 'not created yet — fjs run android|ios creates .fjs/flutter',
    };
  }
  const text = fs.readFileSync(pubspec, 'utf8');
  const local = /flutter_fjs:\s*\n\s*path:\s*(\S+)/.exec(text);
  if (local) {
    return { label: 'flutter host', status: 'ok', detail: `.fjs/flutter — flutter_fjs from ${local[1]}` };
  }
  const hosted = /flutter_fjs:\s*(\S+)/.exec(text);
  return {
    label: 'flutter host',
    status: 'ok',
    detail: `.fjs/flutter — flutter_fjs ${hosted ? hosted[1] : 'from pub.dev'}`,
  };
}

// ------------------------------------------------------------- helpers

interface PackageJson {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readPackage(root: string): PackageJson | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as PackageJson;
  } catch {
    return null;
  }
}

/** Walks node_modules by hand instead of using require.resolve: both @ufjs
 * packages declare "exports", which hides their own package.json from the
 * resolver. Walking up also follows pnpm's symlinked workspace layout. */
function installedVersion(root: string, name: string): string | null {
  let dir = root;
  for (;;) {
    const manifest = path.join(dir, 'node_modules', ...name.split('/'), 'package.json');
    if (fs.existsSync(manifest)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8')) as PackageJson;
        return pkg.version ?? null;
      } catch {
        return null;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function minor(version: string): string {
  const [major, min] = version.split('.');
  return `${major}.${min}`;
}

function firstLine(cmd: string, args: string[]): string | null {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 60_000,
  });
  if (r.status !== 0 || !r.stdout) return null;
  return r.stdout.split('\n')[0].trim() || null;
}

function mark(status: Status, color: boolean): string {
  const symbol = status === 'ok' ? '✓' : status === 'warn' ? '!' : '✗';
  if (!color) return symbol;
  const code = status === 'ok' ? 32 : status === 'warn' ? 33 : 31;
  return `\x1B[${code}m${symbol}\x1B[0m`;
}

function dim(value: string, color: boolean): string {
  return color ? `\x1B[2m${value}\x1B[0m` : value;
}
