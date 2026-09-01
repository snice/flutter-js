// fjs create <page|component> — file generators for an existing project.
//
//   fjs create page about                 -> src/pages/about.vue        (/about)
//   fjs create page user/[id] --title 用户  -> src/pages/user/[id].vue    (/user/:id)
//   fjs create page settings --platform app
//   fjs create component Button           -> src/components/Button.vue
//   fjs create module qrcode              -> src/modules/qrcode/ (api + components)
//   fjs create module qrcode --flutter    -> ... and its autolinked Dart side,
//                                            including <qrcode-widget />
//
// The page generator writes the same <route> block the router already reads
// (see pages.ts), then re-derives the route from what it wrote — so what it
// prints is what `fjs build` will see, not a second guess at the convention.
import fs from 'node:fs';
import path from 'node:path';
import { pageFromSource, pagesDir, writeRouteTypes, type Platform } from '../project/pages.js';
import { generateModule, type ModuleOptions } from './module.js';

export const GENERATORS = ['page', 'component', 'module'] as const;
export type Generator = (typeof GENERATORS)[number];

export function isGenerator(value: string): value is Generator {
  return (GENERATORS as readonly string[]).includes(value);
}

interface GenerateOptions extends ModuleOptions {
  name?: string;
  title?: string;
  tab?: number;
  routePath?: string;
  routeName?: string;
  platforms?: Platform[];
  force: boolean;
  dryRun: boolean;
}

const EXAMPLE: Record<Generator, string> = {
  page: 'about',
  component: 'Button',
  module: 'qrcode',
};

export function generateCommand(kind: Generator, argv: string[]): void {
  const opts = parseArgs(kind, argv);
  if (!opts.name) {
    throw new Error(`fjs create ${kind} needs a name, e.g. fjs create ${kind} ${EXAMPLE[kind]}`);
  }
  const root = process.cwd();
  if (kind === 'page') generatePage(root, opts);
  else if (kind === 'module') generateModule(root, opts.name, opts, (file, source) => write(root, file, source, opts));
  else generateComponent(root, opts);
}

// ---------------------------------------------------------------- page

function generatePage(root: string, opts: GenerateOptions): void {
  const dir = pagesDir(root);
  const rel = pageFileName(opts.name!);
  const file = path.join(dir, rel);
  const source = pageSource(rel, opts);
  const page = pageFromSource(dir, file, source);

  write(root, file, source, opts);
  if (!opts.dryRun) writeRouteTypes(root);
  console.log(`route:  ${page.path}`);
  console.log(`name:   ${page.name}   chunk: ${page.chunk}`);
  console.log(`target: ${page.platforms.join(', ')}`);
  console.log(`push:   ${pushSnippet(page.path, page.name)}`);
}

/** The call that navigates here — dynamic routes go by name, so the params
 * are filled in rather than concatenated into a path. */
function pushSnippet(routePath: string, name: string): string {
  const params = [...routePath.matchAll(/:([A-Za-z_][\w-]*)/g)].map((m) => m[1]);
  if (routePath.includes('*')) {
    return `router.push('/anything/deep')  // route.params.pathMatch`;
  }
  if (params.length === 0) return `router.push('${routePath}')`;
  const filled = params.map((p) => `${p}: '…'`).join(', ');
  return `router.push({ name: '${name}', params: { ${filled} } })`;
}

/** `user/[id]` / `user/[id].vue` / `/user/[id]/` all mean the same file. */
function pageFileName(name: string): string {
  const cleaned = name.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\.vue$/, '');
  if (!cleaned) throw new Error('page name is empty');
  const segments = cleaned.split('/');
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..') {
      throw new Error(`bad page name "${name}": segments must not be empty or relative`);
    }
    if (!/^(\[\.\.\.[A-Za-z_][\w-]*\]|\[[A-Za-z_][\w-]*\]|[A-Za-z0-9][\w.-]*)$/.test(segment)) {
      throw new Error(
        `bad page segment "${segment}": use letters, digits, - and _, ` +
          `or [id] / [...rest] for a dynamic segment`,
      );
    }
  }
  return segments.join('/') + '.vue';
}

function pageSource(rel: string, opts: GenerateOptions): string {
  const block: Record<string, unknown> = {};
  if (opts.routePath) block.path = opts.routePath;
  if (opts.routeName) block.name = opts.routeName;
  if (opts.title) block.title = opts.title;
  if (opts.tab !== undefined) block.tab = opts.tab;
  if (opts.platforms) block.platforms = opts.platforms;

  // `[...rest]` is the catch-all: the router reports it as `pathMatch`, not
  // under the name in the brackets (matching vue-router).
  const params = [...rel.matchAll(/\[(\.\.\.)?([A-Za-z_][\w-]*)\]/g)].map((m) =>
    m[1] ? 'pathMatch' : m[2],
  );
  const heading = opts.title ?? titleFromFile(rel);

  const parts: string[] = [];
  if (Object.keys(block).length > 0) {
    parts.push(`<route>\n${JSON.stringify(block)}\n</route>\n`);
  }
  if (params.length > 0) {
    parts.push(
      `<script setup lang="ts">\nimport { useRoute } from 'fjs/router';\n\n` +
        `const route = useRoute();\n</script>\n`,
    );
    parts.push(
      `<template>\n  <view class="page">\n` +
        `    <text class="title">${escapeText(heading)}</text>\n` +
        params
          .map((p) => `    <text class="param">${p}: {{ route.params.${p} }}</text>\n`)
          .join('') +
        `  </view>\n</template>\n`,
    );
  } else {
    parts.push(
      `<template>\n  <view class="page">\n` +
        `    <text class="title">${escapeText(heading)}</text>\n` +
        `  </view>\n</template>\n`,
    );
  }
  parts.push(`<style scoped>
.page {
  flex-grow: 1;
  align-items: center;
  justify-content: center;
}
.title {
  font-size: 24px;
  font-weight: 700;
  color: #111827;
}${params.length > 0 ? `
.param {
  margin-top: 8px;
  font-size: 14px;
  color: #6b7280;
}` : ''}
</style>
`);
  return parts.join('\n');
}

function titleFromFile(rel: string): string {
  const base = rel.replace(/\.vue$/, '').split('/').pop() ?? 'page';
  const bare = base.replace(/^\[(\.\.\.)?/, '').replace(/\]$/, '');
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}

// ----------------------------------------------------------- component

function generateComponent(root: string, opts: GenerateOptions): void {
  const rel = componentFileName(opts.name!);
  const file = path.join(root, 'src', 'components', rel);
  const name = path.basename(rel, '.vue');
  write(root, file, componentSource(name), opts);
  console.log(`use it as: <${name} :label="'…'" />`);
}

function componentFileName(name: string): string {
  const cleaned = name.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\.vue$/, '');
  if (!cleaned) throw new Error('component name is empty');
  const segments = cleaned.split('/');
  for (const segment of segments) {
    if (!/^[A-Za-z][\w-]*$/.test(segment)) {
      throw new Error(`bad component segment "${segment}": letters, digits, - and _ only`);
    }
  }
  const last = segments.length - 1;
  segments[last] = pascal(segments[last]);
  return segments.join('/') + '.vue';
}

function pascal(value: string): string {
  return value
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function componentSource(name: string): string {
  return `<script setup lang="ts">
defineProps<{
  label?: string;
}>();

defineEmits<{
  (e: 'tap'): void;
}>();
</script>

<template>
  <view class="${kebab(name)}" @click="$emit('tap')">
    <text class="label">{{ label }}</text>
    <slot />
  </view>
</template>

<style scoped>
.${kebab(name)} {
  padding: 12px;
}
.label {
  font-size: 16px;
  color: #111827;
}
</style>
`;
}

function kebab(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
}

// --------------------------------------------------------------- shared

function write(root: string, file: string, source: string, opts: GenerateOptions): void {
  const shown = path.relative(root, file) || file;
  if (fs.existsSync(file) && !opts.force) {
    throw new Error(`${shown} already exists — pass --force to overwrite`);
  }
  if (opts.dryRun) {
    console.log(`would write ${shown}:\n`);
    console.log(source);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source);
  console.log(`created ${shown}`);
}

function parseArgs(kind: Generator, argv: string[]): GenerateOptions {
  const opts: GenerateOptions = { force: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--force' || arg === '-f') opts.force = true;
    else if (arg === '--dry-run' || arg === '-n') opts.dryRun = true;
    else if (arg === '--title') opts.title = value(argv, ++i, arg);
    else if (arg === '--tab') {
      const raw = value(argv, ++i, arg);
      const tab = Number(raw);
      if (!Number.isInteger(tab)) throw new Error(`--tab needs an integer, got "${raw}"`);
      opts.tab = tab;
    } else if (arg === '--path') opts.routePath = value(argv, ++i, arg);
    else if (arg === '--route-name') opts.routeName = value(argv, ++i, arg);
    else if (arg === '--platform') opts.platforms = parsePlatforms(value(argv, ++i, arg));
    else if (arg === '--flutter') opts.flutter = true;
    else if (arg === '--no-flutter') opts.flutter = false;
    else if (arg === '--no-component') opts.component = false;
    else if (arg === '--component') opts.component = value(argv, ++i, arg);
    else if (arg === '--prefix') opts.prefix = value(argv, ++i, arg);
    else if (arg === '--widget') opts.widget = value(argv, ++i, arg);
    else if (arg === '--no-widget') opts.widget = false;
    else if (!arg.startsWith('-') && !opts.name) opts.name = arg;
    else throw new Error(`unknown "fjs create ${kind}" option: ${arg}`);
  }
  if (kind !== 'module') {
    for (const flag of ['flutter', 'component', 'prefix', 'widget'] as const) {
      if (opts[flag] !== undefined) {
        throw new Error(`--${flag} only applies to "fjs create module"`);
      }
    }
  }
  if (kind !== 'page') {
    for (const flag of ['title', 'tab', 'routePath', 'routeName', 'platforms'] as const) {
      if (opts[flag] !== undefined) {
        throw new Error(`--${flag === 'routePath' ? 'path' : flag === 'routeName' ? 'route-name' : flag} only applies to "fjs create page"`);
      }
    }
  }
  return opts;
}

function parsePlatforms(raw: string): Platform[] {
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    if (part !== 'app' && part !== 'web') {
      throw new Error(`--platform takes app, web or app,web — got "${part}"`);
    }
  }
  if (parts.length === 0) throw new Error('--platform needs a value');
  return parts as Platform[];
}

function value(argv: string[], index: number, flag: string): string {
  const v = argv[index];
  if (v === undefined || v.startsWith('-')) throw new Error(`${flag} needs a value`);
  return v;
}

function escapeText(value: string): string {
  return value.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\{\{/g, '&#123;{');
}
