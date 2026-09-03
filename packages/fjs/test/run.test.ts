import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { selectDevServerPort, type DevPortProbe } from '../src/commands/run.js';

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
