// Project configuration: build settings stay in package.json, while native
// app settings live in the root-level app.config.ts.
//
// Settings live here rather than in flags when a later command has to
// remember them: `fjs host eject` moves the host, `fjs.shared` changes how
// every split build is chunked. Flags still win over the file.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import esbuild from 'esbuild';

export const DEFAULT_FLUTTER_DIR = '.fjs/flutter';

export type PlistValue = string | number | boolean | string[] | number[];

export interface AndroidHostConfig {
  applicationId?: string;
  permissions?: string[];
}

export interface IosHostConfig {
  bundleIdentifier?: string;
  infoPlist?: Record<string, PlistValue>;
}

export interface AppConfig {
  android?: AndroidHostConfig;
  ios?: IosHostConfig;
}

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

const APP_CONFIG_FILES = ['app.config.ts', 'app.config.js', 'app.config.mjs', 'app.config.cjs', 'app.config.json'];
const APP_ID_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
const ANDROID_PERMISSION_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

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

/** Reads the optional native app config without adding a runtime loader
 * dependency. esbuild is already part of the CLI, and compiling the small
 * config file here also lets a new project use TypeScript immediately. */
export function readAppConfig(root = process.cwd()): AppConfig {
  const file = APP_CONFIG_FILES
    .map((name) => path.join(root, name))
    .find((candidate) => fs.existsSync(candidate));
  if (!file) return {};

  let value: unknown;
  try {
    if (path.extname(file) === '.json') {
      value = JSON.parse(fs.readFileSync(file, 'utf8'));
    } else {
      const source = fs.readFileSync(file, 'utf8');
      const transformed = esbuild.transformSync(source, {
        loader: path.extname(file) === '.ts' ? 'ts' : 'js',
        format: 'cjs',
        platform: 'node',
        target: 'node18',
        sourcefile: file,
      }).code;
      const moduleValue: { exports: unknown } = { exports: {} };
      const evaluate = new Function(
        'module',
        'exports',
        'require',
        '__filename',
        '__dirname',
        transformed,
      ) as (
        module: { exports: unknown },
        exports: unknown,
        require: NodeRequire,
        filename: string,
        dirname: string,
      ) => void;
      evaluate(
        moduleValue,
        moduleValue.exports,
        createRequire(file),
        file,
        path.dirname(file),
      );
      const exported = moduleValue.exports as { default?: unknown };
      value = exported.default ?? moduleValue.exports;
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`could not load ${path.basename(file)}: ${detail}`);
  }

  return validateAppConfig(value, file);
}

function validateAppConfig(value: unknown, file: string): AppConfig {
  if (!isRecord(value)) throw new Error(`${path.basename(file)} must export an object`);
  const config: AppConfig = {};
  if (value.android !== undefined) {
    if (!isRecord(value.android)) throw new Error(`${path.basename(file)} android must be an object`);
    const android: AndroidHostConfig = {};
    if (value.android.applicationId !== undefined) {
      android.applicationId = requirePattern(
        value.android.applicationId,
        APP_ID_RE,
        `${path.basename(file)} android.applicationId`,
      );
    }
    if (value.android.permissions !== undefined) {
      if (!Array.isArray(value.android.permissions)) {
        throw new Error(`${path.basename(file)} android.permissions must be an array`);
      }
      android.permissions = [...new Set(value.android.permissions.map((permission, index) =>
        requirePattern(
          permission,
          ANDROID_PERMISSION_RE,
          `${path.basename(file)} android.permissions[${index}]`,
        ),
      ))];
    }
    config.android = android;
  }
  if (value.ios !== undefined) {
    if (!isRecord(value.ios)) throw new Error(`${path.basename(file)} ios must be an object`);
    const ios: IosHostConfig = {};
    if (value.ios.bundleIdentifier !== undefined) {
      ios.bundleIdentifier = requirePattern(
        value.ios.bundleIdentifier,
        APP_ID_RE,
        `${path.basename(file)} ios.bundleIdentifier`,
      );
    }
    if (value.ios.infoPlist !== undefined) {
      if (!isRecord(value.ios.infoPlist)) {
        throw new Error(`${path.basename(file)} ios.infoPlist must be an object`);
      }
      ios.infoPlist = {};
      for (const [key, entry] of Object.entries(value.ios.infoPlist)) {
        if (!key || !isPlistValue(entry)) {
          throw new Error(
            `${path.basename(file)} ios.infoPlist.${key || '<empty>'} must be a plist scalar or array`,
          );
        }
        ios.infoPlist[key] = entry;
      }
    }
    config.ios = ios;
  }
  return config;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requirePattern(value: unknown, pattern: RegExp, label: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`${label} must be a valid dot-separated identifier`);
  }
  return value;
}

function isPlistValue(value: unknown): value is PlistValue {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return true;
  }
  return Array.isArray(value) &&
    value.every((entry) => typeof entry === 'string' || typeof entry === 'number');
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
