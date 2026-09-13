import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readAppConfig } from '../src/project/config.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-app-config-'));
  tempDirs.push(dir);
  return dir;
}

describe('readAppConfig', () => {
  it('loads a TypeScript config next to package.json', () => {
    const root = tempProject();
    fs.writeFileSync(
      path.join(root, 'app.config.ts'),
      `export default {
        android: {
          applicationId: 'com.acme.demo',
          permissions: ['android.permission.INTERNET', 'android.permission.INTERNET'],
        },
        ios: {
          bundleIdentifier: 'com.acme.demo',
          infoPlist: { NSCameraUsageDescription: 'scan' },
        },
      };`,
    );

    expect(readAppConfig(root)).toEqual({
      android: {
        applicationId: 'com.acme.demo',
        permissions: ['android.permission.INTERNET'],
      },
      ios: {
        bundleIdentifier: 'com.acme.demo',
        infoPlist: { NSCameraUsageDescription: 'scan' },
      },
    });
  });

  it('rejects invalid native identifiers', () => {
    const root = tempProject();
    fs.writeFileSync(
      path.join(root, 'app.config.ts'),
      `export default { android: { applicationId: 'not valid' } };`,
    );

    expect(() => readAppConfig(root)).toThrow(/android\.applicationId/);
  });

  it('loads wxmp.appid for the mini-program target', () => {
    const root = tempProject();
    fs.writeFileSync(
      path.join(root, 'app.config.ts'),
      `export default { wxmp: { appid: 'wx55831603b568aa90' } };`,
    );

    expect(readAppConfig(root)).toEqual({ wxmp: { appid: 'wx55831603b568aa90' } });
  });

  it('loads wxmp.setting as an object and rejects other shapes', () => {
    const root = tempProject();
    fs.writeFileSync(
      path.join(root, 'app.config.ts'),
      `export default { wxmp: { setting: { minified: true, es6: true } } };`,
    );
    expect(readAppConfig(root)).toEqual({ wxmp: { setting: { minified: true, es6: true } } });

    const root2 = tempProject();
    tempDirs.push(root2);
    fs.writeFileSync(path.join(root2, 'app.config.ts'), `export default { wxmp: { setting: true } };`);
    expect(() => readAppConfig(root2)).toThrow(/wxmp\.setting/);
  });

  it('accepts wxmp.renderer webview/skyline and rejects others', () => {
    const root = tempProject();
    fs.writeFileSync(
      path.join(root, 'app.config.ts'),
      `export default { wxmp: { renderer: 'skyline' } };`,
    );
    expect(readAppConfig(root)).toEqual({ wxmp: { renderer: 'skyline' } });

    const root2 = tempProject();
    tempDirs.push(root2);
    fs.writeFileSync(
      path.join(root2, 'app.config.ts'),
      `export default { wxmp: { renderer: 'webview' } };`,
    );
    expect(readAppConfig(root2)).toEqual({ wxmp: { renderer: 'webview' } });

    const root3 = tempProject();
    tempDirs.push(root3);
    fs.writeFileSync(
      path.join(root3, 'app.config.ts'),
      `export default { wxmp: { renderer: ' FLUTTER ' } };`,
    );
    expect(() => readAppConfig(root3)).toThrow(/wxmp\.renderer/);
  });

  it('rejects a malformed wxmp.appid', () => {
    const root = tempProject();
    fs.writeFileSync(
      path.join(root, 'app.config.ts'),
      `export default { wxmp: { appid: 'not-an-appid' } };`,
    );

    expect(() => readAppConfig(root)).toThrow(/wxmp\.appid/);
  });
});
