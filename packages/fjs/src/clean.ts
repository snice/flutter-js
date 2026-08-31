// fjs clean — delete what fjs generated, and nothing else.
//
// Every path here is one this CLI writes: the output directory, the release
// assets copied into the Flutter host, and the generated route types. The
// Flutter host itself is only removed with --all, because recreating it
// costs a `flutter create` plus a `pub get`.
import fs from 'node:fs';
import path from 'node:path';
import { ROUTE_TYPES_FILE } from './pages.js';
import { flutterDir as configuredFlutterDir, isEjected } from './config.js';

interface CleanOptions {
  outDir: string;
  flutterDir: string;
  all: boolean;
  dryRun: boolean;
}

export function cleanCommand(argv: string[]): void {
  const opts = parseArgs(argv);
  const root = process.cwd();
  const targets: Array<[string, string]> = [
    [path.resolve(root, opts.outDir), 'build output'],
    [path.resolve(root, opts.flutterDir, 'assets', 'fjs'), 'release assets'],
    [path.resolve(root, ROUTE_TYPES_FILE), 'generated route types'],
  ];
  if (opts.all) {
    // an ejected host is the user's own tracked source, not build output
    if (isEjected(root)) {
      throw new Error(
        `--all removes the Flutter host, but ${opts.flutterDir} is yours since ` +
          'fjs host eject — delete it yourself if that is really the intent',
      );
    }
    targets.push([path.resolve(root, opts.flutterDir), 'Flutter host']);
  }

  // a typo in --out or --flutter-dir must not become `rm -rf` somewhere
  // else: this command only ever deletes inside the project
  for (const [target, label] of targets) {
    if (!isInside(root, target)) {
      throw new Error(
        `refusing to remove ${target} (${label}): it is outside ${root}`,
      );
    }
  }

  // --all removes the Flutter host wholesale, so the release assets inside
  // it are not a separate line (or a second count of the same bytes)
  const pruned = targets.filter(
    ([target]) => !targets.some(([other]) => other !== target && isInside(other, target)),
  );

  let freed = 0;
  let removed = 0;
  for (const [target, label] of pruned) {
    if (!fs.existsSync(target)) continue;
    const size = sizeOf(target);
    freed += size;
    removed++;
    const shown = path.relative(root, target) || target;
    if (opts.dryRun) {
      console.log(`would remove ${shown}  (${human(size)}, ${label})`);
      continue;
    }
    fs.rmSync(target, { recursive: true, force: true });
    console.log(`removed ${shown}  (${human(size)}, ${label})`);
  }

  if (removed === 0) {
    console.log('nothing to clean');
    return;
  }
  console.log(`${opts.dryRun ? 'would free' : 'freed'} ${human(freed)}`);
  if (!opts.all) {
    console.log(`(${path.relative(root, path.resolve(root, opts.flutterDir))} kept — --all removes it too)`);
  }
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function sizeOf(target: string): number {
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) return stat.size;
  let total = 0;
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    total += sizeOf(path.join(target, entry.name));
  }
  return total;
}

function human(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function parseArgs(argv: string[]): CleanOptions {
  const opts: CleanOptions = {
    outDir: 'dist',
    flutterDir: configuredFlutterDir(),
    all: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--all') opts.all = true;
    else if (arg === '--dry-run' || arg === '-n') opts.dryRun = true;
    else if (arg === '--out') opts.outDir = value(argv, ++i, arg);
    else if (arg === '--flutter-dir') opts.flutterDir = value(argv, ++i, arg);
    else throw new Error(`unknown clean option: ${arg}`);
  }
  return opts;
}

function value(argv: string[], index: number, flag: string): string {
  const v = argv[index];
  if (v === undefined || v.startsWith('-')) throw new Error(`${flag} needs a value`);
  return v;
}
