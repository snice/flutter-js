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
});
