import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  selectDevServerPort,
  syncNativeHostConfig,
  type DevPortProbe,
} from '../src/commands/run.js';

function probe(options: {
  fjs?: Record<number, string | null>;
  occupied?: number[];
}): DevPortProbe {
  return {
    async fjsDevServerRoot(port) {
      return options.fjs?.[port] ?? null;
    },
    async canConnect(_host, port) {
      return options.occupied?.includes(port) ?? false;
    },
  };
}

describe('selectDevServerPort', () => {
  const root = path.resolve('/tmp/fjs-app');
  const other = path.resolve('/tmp/other-fjs-app');

  it('reuses an existing fjs dev server for the same project', async () => {
    await expect(
      selectDevServerPort(38900, root, probe({ fjs: { 38900: root } })),
    ).resolves.toEqual({ port: 38900, reuseExisting: true, skipped: [] });
  });

  it('skips a port used by another fjs dev project', async () => {
    await expect(
      selectDevServerPort(38900, root, probe({ fjs: { 38900: other } })),
    ).resolves.toEqual({
      port: 38901,
      reuseExisting: false,
      skipped: [{ port: 38900, reason: `already used by another fjs dev project: ${other}` }],
    });
  });

  it('skips a port used by a non-fjs process', async () => {
    await expect(
      selectDevServerPort(38900, root, probe({ occupied: [38900] })),
    ).resolves.toEqual({
      port: 38901,
      reuseExisting: false,
      skipped: [{ port: 38900, reason: 'already in use by another process' }],
    });
  });

  it('can reuse the same project after skipping lower occupied ports', async () => {
    await expect(
      selectDevServerPort(
        38900,
        root,
        probe({ fjs: { 38900: other, 38901: root } }),
      ),
    ).resolves.toEqual({
      port: 38901,
      reuseExisting: true,
      skipped: [{ port: 38900, reason: `already used by another fjs dev project: ${other}` }],
    });
  });

  it('stops after the bounded probe range', async () => {
    await expect(
      selectDevServerPort(38900, root, probe({ occupied: [38900, 38901] }), 2),
    ).rejects.toThrow(/no free fjs dev port found from 38900 to 38901/);
  });
});

describe('syncNativeHostConfig', () => {
  it('updates marked Android and iOS native settings idempotently', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-host-config-'));
    try {
      fs.mkdirSync(path.join(dir, 'android/app/src/main'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'ios/Runner'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'ios/Runner.xcodeproj'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'android/app/build.gradle'),
        'android { defaultConfig { applicationId = "com.example.old" } }\n',
      );
      fs.writeFileSync(
        path.join(dir, 'android/app/src/main/AndroidManifest.xml'),
        '<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n</manifest>\n',
      );
      fs.writeFileSync(
        path.join(dir, 'ios/Runner.xcodeproj/project.pbxproj'),
        [
          'PRODUCT_BUNDLE_IDENTIFIER = com.example.old;',
          'PRODUCT_BUNDLE_IDENTIFIER = com.example.old.RunnerTests;',
        ].join('\n'),
      );
      fs.writeFileSync(
        path.join(dir, 'ios/Runner/Info.plist'),
        '<?xml version="1.0"?><plist><dict></dict></plist>\n',
      );

      const config = {
        android: {
          applicationId: 'com.acme.demo',
          permissions: [
            'android.permission.INTERNET',
            'android.permission.ACCESS_NETWORK_STATE',
          ],
        },
        ios: {
          bundleIdentifier: 'com.acme.demo',
          infoPlist: {
            NSCameraUsageDescription: 'scan & "connect"',
          },
        },
      };
      syncNativeHostConfig(dir, config);
      syncNativeHostConfig(dir, config);

      const manifest = fs.readFileSync(
        path.join(dir, 'android/app/src/main/AndroidManifest.xml'),
        'utf8',
      );
      expect(manifest.match(/fjs: configured permissions/g)).toHaveLength(1);
      expect(manifest.match(/android:name=/g)).toHaveLength(2);
      expect(manifest).toContain('android.permission.ACCESS_NETWORK_STATE');

      expect(fs.readFileSync(path.join(dir, 'android/app/build.gradle'), 'utf8'))
        .toContain('applicationId = "com.acme.demo"');
      expect(fs.readFileSync(path.join(dir, 'ios/Runner.xcodeproj/project.pbxproj'), 'utf8'))
        .toContain('PRODUCT_BUNDLE_IDENTIFIER = com.acme.demo.RunnerTests;');

      const plist = fs.readFileSync(path.join(dir, 'ios/Runner/Info.plist'), 'utf8');
      expect(plist.match(/fjs: configured values/g)).toHaveLength(1);
      expect(plist).toContain('scan &amp; &quot;connect&quot;');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
