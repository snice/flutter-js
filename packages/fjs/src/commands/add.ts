// fjs add — install a JS library into an fjs app, wired up.
//
//   fjs add pinia          package.json + src/plugins/pinia.ts + main.ts
//   fjs add dayjs          package.json only
//   fjs add --list         what this knows about
//
// The registry is data (registry/packages.json), and every entry is one of
// two kinds — which is the whole reason this command exists:
//
//   'dep'    the library is pure JS and needs nothing but a dependency.
//   'plugin' the library needs `app.use()`, so it also gets a file in
//            src/plugins/, which builds collect into 'fjs/plugins'. The
//            app entry is patched once, ever, to pass that list on.
//
// Native capabilities (camera, storage, http — anything that touches the
// Flutter host's pubspec) are NOT here: they are `fjs native add`, because
// they have a different lifecycle (list/remove/sync against an ejectable
// host) and a different blast radius. `requires` is the seam between them.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pluginsDir } from '../project/plugins.js';
import { RECIPES, findRecipe, type Kind, type Recipe } from '../registry/index.js';

interface AddOptions {
  names: string[];
  dryRun: boolean;
  force: boolean;
  install: boolean;
  list: boolean;
  entry: string;
}

export function addCommand(argv: string[]): void {
  const opts = parseArgs(argv);
  if (opts.list) return listRecipes();
  if (opts.names.length === 0) {
    throw new Error('fjs add needs a package, e.g. fjs add pinia (fjs add --list for the list)');
  }
  const root = process.cwd();
  const pkgPath = path.join(root, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    throw new Error('no package.json here — run fjs add from an fjs project');
  }

  const recipes = opts.names.map(findRecipe);
  const changed: string[] = [];
  const notes: string[] = [];
  const text = fs.readFileSync(pkgPath, 'utf8');
  // keep the user's indentation: this file is in their repo
  const indent = /\n(\s+)"/.exec(text)?.[1] ?? '  ';
  const pkg = JSON.parse(text) as Record<string, unknown>;
  let pkgDirty = false;
  let needsEntryPatch = false;

  for (const recipe of recipes) {
    for (const [field, deps] of [
      ['dependencies', recipe.deps],
      ['devDependencies', recipe.devDeps],
    ] as const) {
      for (const [dep, range] of Object.entries(deps ?? {})) {
        const bucket = (pkg[field] ??= {}) as Record<string, string>;
        if (bucket[dep]) {
          notes.push(
            `${dep} is already a ${field.replace('ies', 'y')} (${bucket[dep]}) — left alone`,
          );
          continue;
        }
        bucket[dep] = range;
        pkgDirty = true;
        changed.push(`package.json  + ${field}.${dep} ${range}`);
      }
    }

    for (const cap of recipe.requires ?? []) {
      notes.push(`${recipe.name} needs the "${cap}" host capability: fjs native add ${cap}`);
    }
    notes.push(...(recipe.notes ?? []));

    if (recipe.kind !== 'plugin' || !recipe.plugin) continue;
    const file = path.join(pluginsDir(root), recipe.plugin.file);
    const rel = path.relative(root, file);
    if (fs.existsSync(file) && !opts.force) {
      notes.push(`${rel} exists — kept (use --force to overwrite)`);
    } else {
      changed.push(`${rel}  ${fs.existsSync(file) ? 'overwritten' : 'created'}`);
      if (!opts.dryRun) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, recipe.plugin.source);
      }
    }
    needsEntryPatch = true;
  }

  if (needsEntryPatch) {
    const entryPath = path.resolve(root, opts.entry);
    const patch = patchEntry(entryPath);
    if (patch.status === 'patched') {
      changed.push(`${path.relative(root, entryPath)}  + plugins from 'fjs/plugins'`);
      if (!opts.dryRun) fs.writeFileSync(entryPath, patch.source);
    } else if (patch.status === 'manual') {
      notes.push(
        `could not patch ${path.relative(root, entryPath)} automatically — add by hand:\n` +
          `    import { plugins } from 'fjs/plugins';\n` +
          `    createFjsApp({ routes, shell: Shell, plugins }).mount();`,
      );
    }
  }

  // fjs.shared: keeps a --pages build down to one instance of a library
  // that page chunks import directly. fjs.packages is informational.
  const fjsField = (pkg.fjs ??= {}) as Record<string, unknown>;
  const shared = new Set((fjsField.shared as string[] | undefined) ?? []);
  const installed = new Set((fjsField.packages as string[] | undefined) ?? []);
  for (const recipe of recipes) {
    for (const id of recipe.shared ?? []) {
      if (shared.has(id)) continue;
      shared.add(id);
      pkgDirty = true;
      changed.push(`package.json  + fjs.shared ${id}  (one instance across page chunks)`);
    }
    if (!installed.has(recipe.name)) {
      installed.add(recipe.name);
      pkgDirty = true;
    }
  }
  if (shared.size) fjsField.shared = [...shared].sort();
  fjsField.packages = [...installed].sort();

  if (pkgDirty && !opts.dryRun) {
    fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, indent)}\n`);
  }

  if (changed.length === 0) console.log('nothing to do — already added');
  else for (const line of changed) console.log(`  ${line}`);
  for (const note of [...new Set(notes)]) console.log(`  note: ${note}`);

  if (opts.dryRun) {
    console.log('\n--dry-run: nothing written');
    return;
  }
  const pm = packageManager(root);
  if (opts.install && pkgDirty) {
    console.log(`\n${pm} install`);
    const res = spawnSync(pm, ['install'], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (res.status !== 0) console.log(`\n${pm} install failed — run it yourself when ready`);
  } else if (pkgDirty) {
    console.log(`\nnext: ${pm} install`);
  }
}

// ---- entry patch -----------------------------------------------------------

type Patch =
  | { status: 'patched'; source: string }
  | { status: 'already' }
  | { status: 'manual' };

/** Adds `plugins` to the createFjsApp call, once. Idempotent: a second
 * `fjs add <plugin>` sees the import and does nothing. */
export function patchEntry(entryPath: string): Patch {
  if (!fs.existsSync(entryPath)) return { status: 'manual' };
  const source = fs.readFileSync(entryPath, 'utf8');
  if (/from ['"]fjs\/plugins['"]/.test(source)) return { status: 'already' };

  const call = /createFjsApp\(\s*\{/.exec(source);
  if (!call) return { status: 'manual' };

  // insert the import after the last top-level import line
  const imports = [...source.matchAll(/^import .*?;$/gm)];
  if (imports.length === 0) return { status: 'manual' };
  const last = imports[imports.length - 1];
  const at = (last.index ?? 0) + last[0].length;
  let out = source.slice(0, at) + `\nimport { plugins } from 'fjs/plugins';` + source.slice(at);

  // and `plugins,` as the first property of the options object
  const call2 = /createFjsApp\(\s*\{/.exec(out);
  if (!call2) return { status: 'manual' };
  const brace = (call2.index ?? 0) + call2[0].length;
  const multiline = out.slice(brace, brace + 40).includes('\n');
  out = out.slice(0, brace) + (multiline ? '\n  plugins,' : ' plugins,') + out.slice(brace);
  return { status: 'patched', source: out };
}

// ---- helpers ---------------------------------------------------------------

function listRecipes(): void {
  console.log('fjs add — JS libraries this knows how to wire up\n');
  for (const kind of ['dep', 'plugin'] as Kind[]) {
    const group = RECIPES.filter((r) => r.kind === kind);
    if (!group.length) continue;
    console.log(
      kind === 'dep'
        ? 'dependency only (package.json):'
        : "plugin (package.json + src/plugins/ + 'fjs/plugins'):",
    );
    for (const r of group) console.log(`  ${r.name.padEnd(12)} ${describe(r)}`);
    console.log('');
  }
  console.log('native capabilities (pubspec, Dart host) live under: fjs native add <capability>');
}

function describe(recipe: Recipe): string {
  const tags: string[] = [];
  if (recipe.shared?.length) tags.push('shared chunk');
  if (recipe.targets?.length) tags.push(recipe.targets.join('+') + ' only');
  return tags.length ? `${recipe.description}  [${tags.join(', ')}]` : recipe.description;
}

function packageManager(root: string): string {
  let dir = root;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
    if (fs.existsSync(path.join(dir, 'yarn.lock'))) return 'yarn';
    if (fs.existsSync(path.join(dir, 'bun.lockb'))) return 'bun';
    if (fs.existsSync(path.join(dir, 'package-lock.json'))) return 'npm';
    const up = path.dirname(dir);
    if (up === dir) return 'npm';
    dir = up;
  }
}

function parseArgs(argv: string[]): AddOptions {
  const opts: AddOptions = {
    names: [],
    dryRun: false,
    force: false,
    install: true,
    list: false,
    entry: path.join('src', 'main.ts'),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--force') opts.force = true;
    else if (arg === '--no-install') opts.install = false;
    else if (arg === '--list') opts.list = true;
    else if (arg === '--entry') opts.entry = argv[++i] ?? opts.entry;
    else if (arg.startsWith('-')) throw new Error(`unknown option ${arg}`);
    else opts.names.push(arg);
  }
  return opts;
}
