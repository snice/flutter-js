#!/usr/bin/env node
// Builds the fjsc bytecode compiler for one target and lays it out as an npm
// package under packages/fjsc/npm/<name>/.
//
// fjsc has to come from the same QuickJS-ng sources the runtime embeds — a
// bundle compiled by a mismatched fjsc is rejected at load time by the engine
// id check in fjs_bundle_check. That is why this builds from
// packages/flutter_fjs/native rather than downloading anything.
//
// A target is packaged from prebuilt/<target>/ when a binary is sitting there,
// and compiled from source otherwise. Linux and Windows binaries cannot be
// produced on macOS, so .github/workflows/fjsc-release.yml builds them on
// native runners; you unzip its artifact into prebuilt/ at release time.
// prebuilt/ is gitignored — see docs/publishing.md.
//
//   node build.mjs                  # host platform
//   node build.mjs darwin-x64       # one target
//   node build.mjs --all            # every target @ufjs/cli declares
//   node build.mjs --all-darwin     # both macOS targets
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const nativeDir = path.join(repo, 'packages', 'flutter_fjs', 'native');
const outRoot = path.join(here, 'npm');
const prebuiltRoot = path.join(here, 'prebuilt');
const version = JSON.parse(
  fs.readFileSync(path.join(repo, 'packages', 'fjs', 'package.json'), 'utf8'),
).version;

/** target -> extra cmake flags. Everything else builds natively. */
const TARGETS = {
  'darwin-arm64': ['-DCMAKE_OSX_ARCHITECTURES=arm64', '-DCMAKE_OSX_DEPLOYMENT_TARGET=11.0'],
  'darwin-x64': ['-DCMAKE_OSX_ARCHITECTURES=x86_64', '-DCMAKE_OSX_DEPLOYMENT_TARGET=10.15'],
  'linux-x64': [],
  'linux-arm64': [],
  'win32-x64': [],
};

function hostTarget() {
  const arch = os.arch() === 'arm64' ? 'arm64' : 'x64';
  return `${process.platform}-${arch}`;
}

/** Compiles fjsc for `target` and returns the path of the binary. */
function compile(target, exe) {
  const flags = TARGETS[target];
  const buildDir = path.join(here, 'build', target);

  console.log(`==> compiling fjsc for ${target}`);
  fs.rmSync(buildDir, { recursive: true, force: true });
  execFileSync('cmake', ['-S', nativeDir, '-B', buildDir, '-DCMAKE_BUILD_TYPE=Release', ...flags], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  execFileSync('cmake', ['--build', buildDir, '--target', 'fjsc', '--config', 'Release'], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  // multi-config generators (Visual Studio) nest the binary under Release/
  const candidates = [path.join(buildDir, exe), path.join(buildDir, 'Release', exe)];
  const built = candidates.find((p) => fs.existsSync(p));
  if (!built) throw new Error(`fjsc not found after build (looked in ${candidates.join(', ')})`);
  return built;
}

/** True when this machine can compile for `target` at all. */
function buildable(target) {
  if (target.startsWith('darwin')) return process.platform === 'darwin';
  if (target.startsWith('win32')) return process.platform === 'win32';
  const arch = os.arch() === 'arm64' ? 'arm64' : 'x64';
  return process.platform === 'linux' && target === `linux-${arch}`;
}

function build(target) {
  if (!TARGETS[target]) {
    throw new Error(`unknown target ${target} (have: ${Object.keys(TARGETS).join(', ')})`);
  }

  const pkgDir = path.join(outRoot, `fjsc-${target}`);
  const exe = target.startsWith('win32') ? 'fjsc.exe' : 'fjsc';
  const committed = path.join(prebuiltRoot, target, exe);

  let built;
  let origin;
  if (fs.existsSync(committed)) {
    // a binary CI produced — trust it over a local build, so `--all` gives the
    // same set of packages wherever it runs
    built = committed;
    origin = `prebuilt/${target}`;
  } else if (buildable(target)) {
    built = compile(target, exe);
    origin = 'compiled';
  } else {
    throw new Error(
      `${target} cannot be built on ${process.platform}-${os.arch()} and ` +
        `packages/fjsc/prebuilt/${target}/${exe} is missing.\n` +
        `Run the "Build fjsc binaries" GitHub Actions workflow and unzip its ` +
        `fjsc-prebuilt artifact into packages/fjsc/ (nothing to commit).`,
    );
  }

  fs.rmSync(pkgDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(pkgDir, 'bin'), { recursive: true });
  fs.copyFileSync(built, path.join(pkgDir, 'bin', exe));
  fs.chmodSync(path.join(pkgDir, 'bin', exe), 0o755);

  const [platform, arch] = target.split('-');
  fs.writeFileSync(
    path.join(pkgDir, 'package.json'),
    JSON.stringify(
      {
        name: `@ufjs/fjsc-${target}`,
        version,
        description: `Prebuilt fjsc (QuickJS bytecode compiler) for ${target}`,
        license: 'MIT',
        repository: {
          type: 'git',
          url: 'git+https://github.com/snice/flutter-js.git',
          directory: 'packages/fjsc',
        },
        os: [platform],
        cpu: [arch],
        files: ['bin', 'README.md', 'LICENSE', 'LICENSE-quickjs-ng'],
        publishConfig: { access: 'public' },
      },
      null,
      2,
    ) + '\n',
  );
  fs.writeFileSync(
    path.join(pkgDir, 'README.md'),
    `# @ufjs/fjsc-${target}\n\n` +
      `Prebuilt \`fjsc\` for \`${target}\`. Installed automatically as an optional\n` +
      `dependency of [\`@ufjs/cli\`](https://www.npmjs.com/package/@ufjs/cli) on this\n` +
      `platform; there is no reason to depend on it directly.\n\n` +
      `\`fjsc\` compiles a JS bundle to QuickJS bytecode for \`fjs build --bytecode\`\n` +
      `and \`fjs build --release\`. It is built from the same QuickJS-ng sources the\n` +
      `\`flutter_fjs\` runtime embeds.\n\nMIT — bundles QuickJS-ng, see LICENSE-quickjs-ng.\n`,
  );
  fs.copyFileSync(path.join(repo, 'LICENSE'), path.join(pkgDir, 'LICENSE'));
  fs.copyFileSync(
    path.join(repo, 'packages', 'flutter_fjs', 'LICENSE-quickjs-ng'),
    path.join(pkgDir, 'LICENSE-quickjs-ng'),
  );

  const size = (fs.statSync(path.join(pkgDir, 'bin', exe)).size / 1024).toFixed(0);
  console.log(`    ${path.relative(repo, pkgDir)}  (${size} KB, ${origin})`);
}

const args = process.argv.slice(2);
const targets = args.includes('--all')
  ? Object.keys(TARGETS)
  : args.includes('--all-darwin')
    ? ['darwin-arm64', 'darwin-x64']
    : args.length > 0
      ? args
      : [hostTarget()];
try {
  for (const t of targets) build(t);
} catch (err) {
  console.error(`fjsc build: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
