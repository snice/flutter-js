// fjs modules — what the project imports by name, and what that pulls into
// the Flutter host. The answer to "is my module actually linked?".
import path from 'node:path';
import { autolinkEntries, scanModules, writeModuleTypes } from '../project/modules.js';

export function modulesCommand(argv: string[]): void {
  let json = false;
  for (const arg of argv) {
    if (arg === '--json') json = true;
    else throw new Error(`unknown "fjs modules" option: ${arg}`);
  }
  const root = process.cwd();
  const modules = scanModules(root);
  writeModuleTypes(root, modules);
  const autolink = autolinkEntries(root, modules);

  if (json) {
    console.log(
      JSON.stringify(
        modules.map((mod) => ({
          name: mod.name,
          source: mod.local ? 'local' : 'npm',
          dir: path.relative(root, mod.dir) || '.',
          entry: path.relative(root, mod.entry),
          components: mod.components.map((c) => ({
            name: c.name,
            file: path.relative(root, c.file),
          })),
          widgets: mod.widgets.map((w) => ({
            tag: w.tag,
            web: w.web ? path.relative(root, w.web) : null,
            props: w.props ?? null,
          })),
          flutter: mod.flutter ?? null,
        })),
        null,
        2,
      ),
    );
    return;
  }

  if (modules.length === 0) {
    console.log('no modules — create one with: fjs create module <name>');
    return;
  }
  for (const mod of modules) {
    const where = mod.local ? path.relative(root, mod.dir) : 'node_modules';
    console.log(`${mod.name}  (${mod.local ? 'local' : 'npm'}: ${where})`);
    console.log(`  import  import { … } from '${mod.name}'`);
    if (mod.components.length > 0) {
      console.log(`  tags    ${mod.components.map((c) => `<${c.name} />`).join('  ')}`);
    }
    if (mod.widgets.length > 0) {
      console.log(
        `  widgets ${mod.widgets
          .map((w) => `<${w.tag} />${w.web ? '' : '  (app only)'}`)
          .join('  ')}`,
      );
    }
    if (mod.flutter) {
      const dep = mod.flutter.path ?? mod.flutter.version ?? '';
      console.log(`  flutter ${mod.flutter.package}  ${dep}`);
      if (mod.flutter.register) console.log(`          ${mod.flutter.register};`);
    }
  }
  if (autolink.length > 0) {
    console.log(
      `\nautolinked into the Flutter host: ${autolink
        .map((entry) => entry.flutter.package)
        .join(', ')}`,
    );
  }
}
