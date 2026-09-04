// Local assets: how they reach the two hosts (specs/017-local-image-assets).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { publicAssetDirs } from '../src/commands/run.js';
import { assetOutputOptions, ASSET_LOADERS } from '../src/bundler/build.js';

function tmpHost(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-assets-'));
}

function write(dir: string, relative: string, body = 'x'): void {
  const file = path.join(dir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

describe('publicAssetDirs', () => {
  it('lists every level, because Flutter asset globs do not recurse', () => {
    // The failure this guards is invisible: `- assets/fjs/public/` alone
    // builds fine and ships an app whose images silently do not load.
    const host = tmpHost();
    write(host, 'assets/fjs/public/favicon.png');
    write(host, 'assets/fjs/public/images/photo.png');
    write(host, 'assets/fjs/public/images/icons/star.png');
    write(host, 'assets/fjs/public/assets/photo-ABC123.png');
    expect(publicAssetDirs(host)).toEqual([
      'assets/fjs/public/',
      'assets/fjs/public/assets/',
      'assets/fjs/public/images/',
      'assets/fjs/public/images/icons/',
    ]);
  });

  it('skips directories that hold no file of their own', () => {
    // pub get fails on an asset entry that matches nothing, so a directory
    // that only exists to hold another directory must not be listed.
    const host = tmpHost();
    write(host, 'assets/fjs/public/deep/nested/photo.png');
    expect(publicAssetDirs(host)).toEqual(['assets/fjs/public/deep/nested/']);
  });

  it('is empty when the app has no local files at all', () => {
    expect(publicAssetDirs(tmpHost())).toEqual([]);
  });
});

describe('assetOutputOptions', () => {
  it('emits into <outDir>/assets and addresses it by a root path', () => {
    const options = assetOutputOptions();
    // publicPath and assetNames are concatenated by esbuild, so this pair is
    // what makes the URL exactly /assets/<name>-<hash>.<ext>. Anything else
    // (a bare outfile, or '../assets/…') puts the file or the URL in the
    // wrong place — see the comment on assetOutputOptions.
    expect(options.publicPath + options.assetNames).toBe('/assets/[name]-[hash]');
  });

  it('covers the file types a page imports', () => {
    for (const ext of ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.woff2']) {
      expect(ASSET_LOADERS[ext]).toBe('file');
    }
  });
});
