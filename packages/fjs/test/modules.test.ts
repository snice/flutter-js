// The module layer, from both ends: what the scanner reads off disk, and
// what the generator writes to it. The round-trip test is the important
// one — `fjs create module` and the build have to agree on the convention,
// and they only do if the scanner recognises what the generator wrote.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  autolinkDart,
  moduleDataDir,
  resolveModuleData,
  runModulePrepare,
  autolinkEntries,
  autolinkPubspecDeps,
  moduleAliases,
  moduleComponentTypesSource,
  moduleComponentsSource,
  moduleTypesSource,
  scanModules,
  widgetFallbacks,
  widgetNativeTags,
  writeModuleTypes,
  MODULE_COMPONENT_TYPES_FILE,
  MODULE_TYPES_FILE,
} from '../src/project/modules.js';
import { pluginTableSource } from '../src/project/plugins.js';
import { generateModule } from '../src/commands/module.js';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-modules-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function write(file: string, contents: string): string {
  const full = path.join(root, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
  return full;
}

function project(deps: Record<string, string> = {}): void {
  write('package.json', JSON.stringify({ name: 'app', dependencies: deps }));
}

/** A module directory, local or installed. */
function module_(
  where: string,
  manifest: Record<string, unknown>,
  files: Record<string, string> = {},
): void {
  write(`${where}/package.json`, JSON.stringify(manifest));
  write(`${where}/index.ts`, 'export const ping = () => "pong";\n');
  for (const [file, contents] of Object.entries(files)) write(`${where}/${file}`, contents);
}

const SFC = '<template><view /></template>\n';

describe('scanModules', () => {
  it('reads a local module and derives its component names', () => {
    project();
    module_('src/modules/qrcode', { name: 'qrcode', fjs: { module: true } }, {
      'components/Scanner.vue': SFC,
      'components/QrcodeBadge.vue': SFC,
    });

    const [mod] = scanModules(root);
    expect(mod.name).toBe('qrcode');
    expect(mod.local).toBe(true);
    expect(mod.entry).toBe(path.join(root, 'src/modules/qrcode/index.ts'));
    // the prefix is the module name, and a file already carrying it keeps it
    expect(mod.components.map((c) => c.name)).toEqual(['QrcodeBadge', 'QrcodeScanner']);
  });

  it('treats a directory under src/modules as a module without a manifest', () => {
    project();
    write('src/modules/plain/index.ts', 'export const x = 1;\n');

    expect(scanModules(root).map((m) => m.name)).toEqual(['plain']);
  });

  it('honours componentPrefix and components: false', () => {
    project();
    module_(
      'src/modules/ui',
      { name: 'ui', fjs: { module: true, componentPrefix: 'Ui' } },
      { 'components/Card.vue': SFC },
    );
    module_('src/modules/api', { name: 'api', fjs: { module: true, components: false } }, {
      'components/Nope.vue': SFC,
    });

    const byName = Object.fromEntries(scanModules(root).map((m) => [m.name, m]));
    expect(byName.ui.components.map((c) => c.name)).toEqual(['UiCard']);
    expect(byName.api.components).toEqual([]);
  });

  it('finds an installed dependency that opts in, and ignores one that does not', () => {
    project({ 'qr-npm': '^1.0.0', lodash: '^4.0.0' });
    module_('node_modules/qr-npm', { name: 'qr-npm', fjs: { module: true } });
    module_('node_modules/lodash', { name: 'lodash' });

    const modules = scanModules(root);
    expect(modules.map((m) => m.name)).toEqual(['qr-npm']);
    expect(modules[0].local).toBe(false);
  });

  it('lets a local module shadow an installed package of the same name', () => {
    project({ qrcode: '^1.0.0' });
    module_('src/modules/qrcode', { name: 'qrcode', fjs: { module: true } });
    module_('node_modules/qrcode', { name: 'qrcode', fjs: { module: true } });

    const modules = scanModules(root);
    expect(modules).toHaveLength(1);
    expect(modules[0].local).toBe(true);
  });

  it('skips a directory with no entry file', () => {
    project();
    write('src/modules/empty/package.json', JSON.stringify({ name: 'empty' }));

    expect(scanModules(root)).toEqual([]);
  });

  it('aliases local modules only — installed ones resolve on their own', () => {
    project({ 'qr-npm': '^1.0.0' });
    module_('src/modules/local-mod', { name: 'local-mod', fjs: { module: true } });
    module_('node_modules/qr-npm', { name: 'qr-npm', fjs: { module: true } });

    expect(moduleAliases(root)).toEqual({
      'local-mod': path.join(root, 'src/modules/local-mod/index.ts'),
    });
  });
});

describe('widgets', () => {
  function widgetProject(): void {
    project();
    module_(
      'src/modules/chart',
      {
        name: 'chart',
        fjs: {
          module: true,
          widgets: {
            'chart-canvas': { web: './components/ChartCanvasWeb.vue' },
            'chart-native': { props: { value: 'number' } },
          },
        },
      },
      { 'components/ChartCanvasWeb.vue': SFC },
    );
  }

  it('marks every widget tag native on Flutter, and only the fallback-less ones on web', () => {
    widgetProject();
    const modules = scanModules(root);
    expect(widgetNativeTags(modules, 'app').sort()).toEqual(['chart-canvas', 'chart-native']);
    expect(widgetNativeTags(modules, 'web')).toEqual(['chart-native']);
  });

  it('keeps a web stand-in out of the global components — it is the tag', () => {
    widgetProject();
    const [mod] = scanModules(root);
    expect(mod.components).toEqual([]);
    expect(widgetFallbacks([mod])).toEqual([
      { tag: 'chart-canvas', file: path.join(root, 'src/modules/chart/components/ChartCanvasWeb.vue') },
    ]);
  });

  it('registers the stand-ins on web and not on Flutter', () => {
    widgetProject();
    const modules = scanModules(root);
    expect(moduleComponentsSource(modules, 'app').register).toEqual([]);
    expect(moduleComponentsSource(modules, 'web').register.join('\n')).toContain(
      'app.component("chart-canvas"',
    );
  });

  it('rejects a tag with no hyphen and a fallback that is not there', () => {
    project();
    module_('src/modules/bad', { name: 'bad', fjs: { module: true, widgets: { chart: {} } } });
    expect(() => scanModules(root)).toThrow(/hyphenated/);

    fs.rmSync(path.join(root, 'src/modules/bad'), { recursive: true });
    module_('src/modules/gone', {
      name: 'gone',
      fjs: { module: true, widgets: { 'x-y': { web: './components/Missing.vue' } } },
    });
    expect(() => scanModules(root)).toThrow(/does not exist/);
  });
});

describe('prepare hook', () => {
  /** A module whose hook writes what the app named. */
  function hookModule(body: string): void {
    project();
    module_('src/modules/gen', { name: 'gen', fjs: { module: true, prepare: './prepare.mjs' } });
    write('src/modules/gen/prepare.mjs', body);
  }

  it('runs the hook and hands it the app sources', async () => {
    hookModule(`export default (ctx) => {
      const names = ctx.sources().map((f) => f.split('/').pop()).join(',');
      ctx.write('out.txt', \`\${ctx.platform}:\${ctx.module.name}:\${names}\`);
    };`);
    write('src/pages/index.vue', '<template><view /></template>');

    await runModulePrepare(root, 'app');
    const out = fs.readFileSync(path.join(moduleDataDir(root, 'gen'), 'out.txt'), 'utf8');
    // its own directory is not part of what it scans — a hook looks at the app
    expect(out).toBe('app:gen:index.vue');
  });

  it('does not rewrite a file whose contents did not change', async () => {
    hookModule(`export default (ctx) => ctx.write('out.txt', 'same');`);
    await runModulePrepare(root, 'app');
    const file = path.join(moduleDataDir(root, 'gen'), 'out.txt');
    const before = fs.statSync(file).mtimeMs;

    await runModulePrepare(root, 'app');
    // the dev server watches this tree: an identical write would loop it
    expect(fs.statSync(file).mtimeMs).toBe(before);
  });

  it('blames the module when its hook throws or is not a function', async () => {
    hookModule(`export default () => { throw new Error('boom'); };`);
    await expect(runModulePrepare(root, 'app')).rejects.toThrow(/module "gen": prepare failed — boom/);

    fs.writeFileSync(path.join(root, 'src/modules/gen/prepare.mjs'), 'export default 42;');
    await expect(runModulePrepare(root, 'app')).rejects.toThrow(/must default-export a function/);
  });

  it('rejects a manifest pointing at a hook that is not there', () => {
    project();
    module_('src/modules/gen', { name: 'gen', fjs: { module: true, prepare: './nope.mjs' } });
    expect(() => scanModules(root)).toThrow(/fjs.prepare points at/);
  });

  it('resolves fjs/data/<file> against the module the importer is in', () => {
    project();
    module_('src/modules/gen', { name: 'gen', fjs: { module: true } });
    module_('src/modules/other', { name: 'other', fjs: { module: true } });
    const modules = scanModules(root);
    const inGen = path.join(root, 'src/modules/gen/components/X.vue');

    expect(resolveModuleData(root, modules, inGen, 'fjs/data/icons.json')).toBe(
      path.join(moduleDataDir(root, 'gen'), 'icons.json'),
    );
    // not from app code, and never out of its own directory
    expect(
      resolveModuleData(root, modules, path.join(root, 'src/pages/index.vue'), 'fjs/data/x.json'),
    ).toBeNull();
    expect(resolveModuleData(root, modules, inGen, 'fjs/data/../../secret')).toBeNull();
  });

  it('references a hook-written types.d.ts from the generated module types', async () => {
    hookModule(`export default (ctx) => ctx.write('types.d.ts', 'interface FjsIcons {}');`);
    await runModulePrepare(root, 'app');
    writeModuleTypes(root);

    const types = fs.readFileSync(path.join(root, MODULE_TYPES_FILE), 'utf8');
    expect(types).toContain('/// <reference path="../.fjs/modules/gen/types.d.ts" />');
  });
});

describe('generated types', () => {
  it('declares the bare specifier for local modules only', () => {
    project({ 'qr-npm': '^1.0.0' });
    module_('src/modules/qrcode', { name: 'qrcode', fjs: { module: true } });
    module_('node_modules/qr-npm', { name: 'qr-npm', fjs: { module: true } });

    const source = moduleTypesSource(root, scanModules(root));
    expect(source).toContain('declare module "qrcode"');
    // `export *` plus one more export: the star alone declares nothing
    expect(source).toContain('export * from "./modules/qrcode/index"');
    expect(source).toContain('export type __FjsModule');
    // installed packages carry their own types
    expect(source).not.toContain('qr-npm');
    // relative to src/, so it resolves the same everywhere
    expect(source).toContain('"./modules/qrcode/index"');
  });

  it('puts components and widgets in GlobalComponents', () => {
    project();
    module_(
      'src/modules/chart',
      {
        name: 'chart',
        fjs: {
          module: true,
          widgets: { 'chart-native': { props: { value: 'number' } } },
        },
      },
      { 'components/Legend.vue': SFC },
    );

    const source = moduleComponentTypesSource(root, scanModules(root));
    expect(source).toContain('"ChartLegend": typeof import("./modules/chart/components/Legend.vue")');
    expect(source).toContain('"chart-native": FjsModuleWidget<{ "value"?: number }>');
    // the tap events every fjs element takes come with the tag
    expect(source).toContain('onTap?: () => void');
  });

  it('writes the files when there is something to declare, and removes them when there is not', () => {
    project();
    module_('src/modules/qrcode', { name: 'qrcode', fjs: { module: true } }, {
      'components/Card.vue': SFC,
    });
    writeModuleTypes(root);
    expect(fs.existsSync(path.join(root, MODULE_TYPES_FILE))).toBe(true);
    expect(fs.existsSync(path.join(root, MODULE_COMPONENT_TYPES_FILE))).toBe(true);

    fs.rmSync(path.join(root, 'src/modules'), { recursive: true });
    writeModuleTypes(root);
    expect(fs.existsSync(path.join(root, MODULE_TYPES_FILE))).toBe(false);
    expect(fs.existsSync(path.join(root, MODULE_COMPONENT_TYPES_FILE))).toBe(false);
  });
});

describe('generated fjs/plugins', () => {
  it('registers module components ahead of the project plugins', () => {
    project();
    module_('src/modules/ui', { name: 'ui', fjs: { module: true } }, { 'components/Card.vue': SFC });
    const plugin = { file: path.join(root, 'src/plugins/pinia.ts'), name: 'pinia', platforms: ['app' as const] };

    const source = pluginTableSource([plugin], scanModules(root));
    expect(source).toContain('app.component("UiCard", __fc0)');
    expect(source).toMatch(/plugins = \[__fjsModuleComponents, __fp0\]/);
  });

  it('is just the project plugins when there are no modules', () => {
    const plugin = { file: path.join(root, 'src/plugins/pinia.ts'), name: 'pinia', platforms: ['app' as const] };
    expect(pluginTableSource([plugin], [])).toContain('plugins = [__fp0]');
  });
});

describe('flutter autolink', () => {
  function flutterModule(extra: Record<string, unknown> = {}): void {
    project();
    module_('src/modules/qrcode', {
      name: 'qrcode',
      fjs: {
        module: true,
        flutter: {
          package: 'fjs_qrcode',
          path: './flutter',
          register: 'FjsQrcode.register(engine)',
          ...extra,
        },
      },
    });
    write('src/modules/qrcode/flutter/pubspec.yaml', 'name: fjs_qrcode\n');
  }

  it('turns a path dependency into a pubspec entry relative to the host', () => {
    flutterModule();
    const entries = autolinkEntries(root);
    expect(entries).toHaveLength(1);
    expect(autolinkPubspecDeps(path.join(root, '.fjs/flutter'), entries)).toBe(
      '  fjs_qrcode:\n    path: ../../src/modules/qrcode/flutter\n',
    );
  });

  it('emits the import and the register call for the host main', () => {
    flutterModule();
    const { imports, registers } = autolinkDart(autolinkEntries(root));
    expect(imports).toBe("import 'package:fjs_qrcode/fjs_qrcode.dart';\n");
    expect(registers).toBe('  FjsQrcode.register(engine);\n');
  });

  it('supports a pub.dev version instead of a path', () => {
    project();
    module_('src/modules/qrcode', {
      name: 'qrcode',
      fjs: { module: true, flutter: { package: 'fjs_qrcode', version: '^0.2.0' } },
    });
    expect(autolinkPubspecDeps('/host', autolinkEntries(root))).toBe('  fjs_qrcode: ^0.2.0\n');
  });

  it('refuses a flutter block with neither a path nor a version', () => {
    project();
    module_('src/modules/qrcode', {
      name: 'qrcode',
      fjs: { module: true, flutter: { package: 'fjs_qrcode' } },
    });
    expect(() => autolinkEntries(root)).toThrow(/"path" or a "version"/);
  });

  it('points at the missing pubspec when the path is wrong', () => {
    flutterModule();
    fs.rmSync(path.join(root, 'src/modules/qrcode/flutter/pubspec.yaml'));
    expect(() => autolinkEntries(root)).toThrow(/pubspec\.yaml/);
  });
});

describe('generateModule', () => {
  const written = new Map<string, string>();
  const write_ = (file: string, source: string): void => {
    written.set(file, source);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
  };

  beforeEach(() => {
    written.clear();
    project();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes a module the scanner reads back the same way', () => {
    generateModule(root, 'qrcode', { flutter: true }, write_);

    const [mod] = scanModules(root);
    expect(mod.name).toBe('qrcode');
    expect(mod.components.map((c) => c.name)).toEqual(['QrcodeView']);
    expect(mod.widgets.map((w) => w.tag)).toEqual(['qrcode-widget']);
    expect(mod.flutter?.package).toBe('fjs_qrcode');
    // the generated Dart registers exactly the tag the manifest declares
    const dart = fs.readFileSync(
      path.join(root, 'src/modules/qrcode/flutter/lib/fjs_qrcode.dart'),
      'utf8',
    );
    expect(dart).toContain("engine.components.register('qrcode-widget', _build)");
    expect(dart).toContain("engine.host.register('qrcode.ping'");
    expect(autolinkEntries(root)).toHaveLength(1);
  });

  it('leaves out the Dart side and the widget by default', () => {
    generateModule(root, 'qrcode', {}, write_);

    const [mod] = scanModules(root);
    expect(mod.widgets).toEqual([]);
    expect(mod.flutter).toBeUndefined();
    expect(fs.existsSync(path.join(root, 'src/modules/qrcode/flutter'))).toBe(false);
  });

  it('--no-component leaves an API-only module', () => {
    generateModule(root, 'api-only', { component: false }, write_);

    const [mod] = scanModules(root);
    expect(mod.components).toEqual([]);
    expect([...written.keys()].some((f) => f.endsWith('.vue'))).toBe(false);
  });

  it('puts a scoped module in its unscoped directory but keeps the scoped name', () => {
    generateModule(root, '@acme/qrcode', {}, write_);

    const [mod] = scanModules(root);
    expect(mod.name).toBe('@acme/qrcode');
    expect(mod.dir).toBe(path.join(root, 'src/modules/qrcode'));
  });

  it('rejects names that are not npm package names, and specifiers fjs owns', () => {
    expect(() => generateModule(root, 'Not Valid', {}, write_)).toThrow(/npm package name/);
    expect(() => generateModule(root, 'fjs', {}, write_)).toThrow(/collides/);
    expect(() => generateModule(root, 'x', { widget: 'nohyphen' }, write_)).toThrow(/hyphenated/);
  });
});
