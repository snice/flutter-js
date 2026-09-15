// A library that imports the runtime by its package name (@ufjs/spine does)
// must read the shared chunk's instance in a --pages build, exactly like
// `import 'fjs'` — a private copy re-runs installEventDispatcher() and kills
// every tap in the app.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import esbuild from 'esbuild';
import { SHARED_BARE_BUILTIN, runtimeSpecifier, sharedStubPlugin } from '../src/bundler/vue-plugin.js';

describe('@ufjs/runtime in page chunks', () => {
  it('maps the package name onto the fjs specifiers', () => {
    expect(runtimeSpecifier('@ufjs/runtime')).toBe('fjs');
    expect(runtimeSpecifier('@ufjs/runtime/router')).toBe('fjs/router');
    expect(runtimeSpecifier('@ufjs/runtimex')).toBe('@ufjs/runtimex');
  });

  it('stubs @ufjs/runtime to the shared fjs instance', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-runtime-pkg-'));
    fs.writeFileSync(
      path.join(dir, 'entry.js'),
      'import { fetch } from "@ufjs/runtime"; import { useRouter } from "@ufjs/runtime/router"; console.log(fetch, useRouter);\n',
    );
    const result = await esbuild.build({
      absWorkingDir: dir,
      entryPoints: ['entry.js'],
      bundle: true,
      write: false,
      outfile: 'out.js',
      format: 'iife',
      plugins: [sharedStubPlugin(undefined, SHARED_BARE_BUILTIN)],
    });
    const js = result.outputFiles[0].text;
    expect(js).toContain('__FJS_SHARED["fjs"]');
    expect(js).toContain('__FJS_SHARED["fjs/router"]');
  });
});
