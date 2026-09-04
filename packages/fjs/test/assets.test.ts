// Local assets: how they reach the two hosts (specs/017-local-image-assets).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { publicAssetDirs } from '../src/commands/run.js';
import { assetOutputOptions, ASSET_LOADERS } from '../src/bundler/build.js';
import { assetTypesSource, scanLocalAssets } from '../src/project/assets.js';
import { analyzeAssetSources } from '../src/bundler/asset-check.js';
import type { PageRoute } from '../src/project/pages.js';

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

describe('scanLocalAssets', () => {
  it('gives each directory its own kind and its own prefix', () => {
    // public/ is vite's root, html/ keeps its name in the URL — the two
    // never share a path, so nothing can silently overwrite anything
    // (specs/018-src-hints-and-html-dir).
    const root = tmpHost();
    write(root, 'public/images/photo.png');
    write(root, 'public/favicon.svg');
    write(root, 'html/guide.html');
    write(root, 'html/policy/terms.html');
    expect(scanLocalAssets(root)).toEqual({
      images: ['/favicon.svg', '/images/photo.png'],
      html: ['/html/guide.html', '/html/policy/terms.html'],
    });
  });

  it('keeps the wrong kind of file out of each table', () => {
    // <image src="/guide.html"> should not complete, so an html file in
    // public/ must not widen the image table (and vice versa).
    const root = tmpHost();
    write(root, 'public/guide.html');
    write(root, 'public/readme.txt');
    write(root, 'html/cover.png');
    expect(scanLocalAssets(root)).toEqual({ images: [], html: [] });
  });

  it('ignores dotfiles and reports nothing for a project with neither dir', () => {
    const root = tmpHost();
    write(root, 'public/.DS_Store');
    expect(scanLocalAssets(root)).toEqual({ images: [], html: [] });
  });

  it('writes both interfaces even when one is empty', () => {
    // the runtime's fallback keys off `keyof X extends never`, so an empty
    // interface still has to be declared
    const source = assetTypesSource({ images: ['/a.png'], html: [] });
    expect(source).toContain('interface FjsImageAssets {');
    expect(source).toContain('"/a.png": true;');
    expect(source).toContain('interface FjsHtmlAssets {');
  });
});

describe('analyzeAssetSources', () => {
  const page = (root: string, file: string): PageRoute[] => [
    { file: path.join(root, file) } as PageRoute,
  ];

  it('names the closest candidate for a literal typo', () => {
    const root = tmpHost();
    write(root, 'public/images/photo.png');
    write(root, 'src/pages/a.vue', '<template><image src="/images/phto.png" /></template>');
    const [warning] = analyzeAssetSources(root, page(root, 'src/pages/a.vue'));
    expect(warning.suggestion).toBe('/images/photo.png');
    expect(warning.text).toContain('no such file in public/');
  });

  it('says nothing about a dynamic src', () => {
    // the whole reason this check only reads static attributes: a warning
    // that fires on correct code teaches people to ignore the channel
    const root = tmpHost();
    write(root, 'src/pages/a.vue', '<template><image :src="whatever" /></template>');
    expect(analyzeAssetSources(root, page(root, 'src/pages/a.vue'))).toEqual([]);
  });

  it('leaves http and imported sources alone', () => {
    const root = tmpHost();
    write(
      root,
      'src/pages/a.vue',
      '<template><image src="https://example.com/x.png" /></template>',
    );
    expect(analyzeAssetSources(root, page(root, 'src/pages/a.vue'))).toEqual([]);
  });

  it('checks each tag against its own table', () => {
    const root = tmpHost();
    write(root, 'public/images/photo.png');
    write(root, 'html/guide.html');
    write(
      root,
      'src/pages/a.vue',
      '<template><view>' +
        '<image src="/html/guide.html" />' +
        '<web-view src="/images/photo.png" />' +
        '</view></template>',
    );
    const warnings = analyzeAssetSources(root, page(root, 'src/pages/a.vue'));
    expect(warnings.map((w) => w.tag)).toEqual(['image', 'web-view']);
  });

  it('ignores a query or hash on an otherwise real file', () => {
    const root = tmpHost();
    write(root, 'html/guide.html');
    write(
      root,
      'src/pages/a.vue',
      '<template><web-view src="/html/guide.html?q=1#top" /></template>',
    );
    expect(analyzeAssetSources(root, page(root, 'src/pages/a.vue'))).toEqual([]);
  });
});

describe('module data on the web', () => {
  it('keeps the /fjs-modules/ URL without a second copy in the app', async () => {
    // The module used to write its pages into the app's own public/, which
    // then rode into the Flutter bundle as a duplicate. The URL contract is
    // unchanged; only who provides the file moved
    // (specs/018-src-hints-and-html-dir).
    const built = path.resolve('../../examples/hello-fjs/dist/web');
    if (!fs.existsSync(built)) return; // needs a web build; skipped otherwise
    expect(fs.existsSync(path.join(built, 'fjs-modules/webview/demo.html'))).toBe(true);
    expect(
      fs.existsSync(path.resolve('../../examples/hello-fjs/public/fjs-modules')),
    ).toBe(false);
  });
});
