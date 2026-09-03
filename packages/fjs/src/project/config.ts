// Project configuration: the `fjs` field of package.json.
//
// Settings live here rather than in flags when a later command has to
// remember them: `fjs host eject` moves the host, `fjs.shared` changes how
// every split build is chunked. Flags still win over the file.
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_FLUTTER_DIR = '.fjs/flutter';

export interface FjsConfig {
  /** Flutter host project directory, relative to the project root. */
  flutterDir?: string;
  /** Build-time performance budgets. */
  performance?: {
    /** Warn when a page's statically estimated first frame renders more nodes. */
    nodeBudget?: number;
  };
  /** Extra bare specifiers to put in the shared chunk of a `--pages`
   * build, on top of the built-in vue/fjs set. See [sharedBare]. */
  shared?: string[];
  /** What `fjs add` has installed. Informational — `fjs doctor` reads it. */
  packages?: string[];
}

export function readConfig(root = process.cwd()): FjsConfig {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      fjs?: FjsConfig;
    };
    return pkg.fjs ?? {};
  } catch {
    return {};
  }
}

/** Where the Flutter host lives: the configured directory, or the managed
 * one under `.fjs`. */
export function flutterDir(root = process.cwd()): string {
  return readConfig(root).flutterDir ?? DEFAULT_FLUTTER_DIR;
}

/** A host outside `.fjs` is the user's: `fjs` creates it and keeps its
 * assets in sync, but never rewrites its Dart or its pubspec again. */
export function isEjected(root = process.cwd()): boolean {
  return readConfig(root).flutterDir !== undefined;
}

/** Merges into the `fjs` field, preserving the rest of package.json —
 * including its indentation, because this file is in the user's repo. */
export function updateConfig(root: string, patch: FjsConfig): void {
  const file = path.join(root, 'package.json');
  const text = fs.readFileSync(file, 'utf8');
  const pkg = JSON.parse(text) as Record<string, unknown> & { fjs?: FjsConfig };
  pkg.fjs = { ...(pkg.fjs ?? {}), ...patch };
  const indent = /\n(\s+)"/.exec(text)?.[1] ?? '  ';
  fs.writeFileSync(file, JSON.stringify(pkg, null, indent) + '\n');
}
