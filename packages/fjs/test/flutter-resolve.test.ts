// Flutter esbuild is platform:neutral. Without mainFields, a package that
// only declares "module"/"main" (no root index.js) fails to resolve —
// @antv/f2 is the specimen that surfaced this.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import esbuild from 'esbuild';
import { flutterEsbuildPlatform } from '../src/bundler/build.js';

function fixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-resolve-'));
  const pkg = path.join(dir, 'node_modules', 'only-module');
  fs.mkdirSync(path.join(pkg, 'es'), { recursive: true });
  fs.writeFileSync(
    path.join(pkg, 'package.json'),
    JSON.stringify({ name: 'only-module', module: 'es/index.js', main: 'lib/index.js' }),
  );
  fs.writeFileSync(path.join(pkg, 'es/index.js'), 'export const ok = 1;\n');
  fs.writeFileSync(path.join(dir, 'entry.js'), 'import { ok } from "only-module"; console.log(ok);\n');
  return dir;
}

describe('flutterEsbuildPlatform', () => {
  it('resolves a package that only has module/main, no root index.js', async () => {
    const dir = fixture();
    const result = await esbuild.build({
      absWorkingDir: dir,
      entryPoints: ['entry.js'],
      bundle: true,
      write: false,
      outfile: 'out.js',
      ...flutterEsbuildPlatform(),
    });
    expect(result.errors).toEqual([]);
    const js = result.outputFiles.map((f) => f.text).join('\n');
    expect(js).toMatch(/ok/);
  });

  it('fails the same package under bare platform:neutral (the old default)', async () => {
    const dir = fixture();
    await expect(
      esbuild.build({
        absWorkingDir: dir,
        entryPoints: ['entry.js'],
        bundle: true,
        write: false,
        outfile: 'out.js',
        platform: 'neutral',
        logLevel: 'silent',
      }),
    ).rejects.toThrow(/Could not resolve/);
  });
});
