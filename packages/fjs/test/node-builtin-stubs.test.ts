import esbuild from 'esbuild';
import { describe, expect, it } from 'vitest';
import { nodeBuiltinStubs } from '../src/bundler/build.js';

// spec 058: platform 'neutral' refuses node builtins outright, so one deep
// require('util') in an npm transitive dep (@pixi/utils → url → qs →
// object-inspect) failed the whole app build. The stub plugin must keep such
// graphs bundling — including eager named imports — while leaving real use
// to throw at call time.

const bundle = async (code: string): Promise<esbuild.Metafile | undefined> => {
  const result = await esbuild.build({
    stdin: { contents: code, loader: 'js', resolveDir: '/' },
    bundle: true,
    write: false,
    metafile: true,
    format: 'iife',
    platform: 'neutral',
    plugins: [nodeBuiltinStubs()],
    logLevel: 'silent',
  });
  return result.metafile;
};

describe('nodeBuiltinStubs', () => {
  it('bundles a bare require("util") property access', async () => {
    const metafile = await bundle(
      'const util = require("util"); export const x = typeof util.inspect;',
    );
    const inputs = Object.keys(metafile?.inputs ?? {});
    expect(inputs).toContain('<stdin>');
    // the stub itself, not the real builtin, landed in the graph
    expect(inputs.length).toBe(2);
    expect(inputs.find((input) => input !== '<stdin>')).toMatch(
      /fjs-builtin-stub/,
    );
  });

  it('bundles eager named imports (node: prefix too)', async () => {
    await bundle('import { format, resolve } from "url"; import fs from "node:fs"; export const x = [format, resolve, fs];');
  });

  it('rejects built-in subpaths like util/types', async () => {
    await bundle('import { types } from "util/types"; export const x = types;');
  });

  it('throws at call time, not import time', async () => {
    const result = await esbuild.build({
      stdin: { contents: 'const util = require("util"); export const x = typeof util.inspect;', loader: 'js', resolveDir: '/' },
      bundle: true,
      write: false,
      format: 'cjs',
      platform: 'neutral',
      plugins: [nodeBuiltinStubs()],
      logLevel: 'silent',
    });
    // run the output: importing is fine, calling the property throws
    const js = result.outputFiles![0].text;
    const mod: { exports: { x: string } } = { exports: {} as never };
    // eslint-disable-next-line no-new-func -- the point is to execute the emitted bundle
    new Function('module', 'exports', js)(mod, mod.exports);
    expect(mod.exports.x).toBe('function');
  });
});
