// File-based routing: scans src/pages/**.vue and generates the route table
// that app code imports as 'fjs/pages'.
//
//   src/pages/index.vue        -> /              (chunk "index")
//   src/pages/about.vue        -> /about         (chunk "about")
//   src/pages/comp/button.vue  -> /comp/button   (chunk "comp-button")
//   src/pages/user/[id].vue    -> /user/:id      (chunk "user-id")
//
// A page can carry a <route> custom block with JSON metadata:
//
//   <route>
//   { "title": "按钮", "tab": 0, "platforms": ["app"] }
//   </route>
//
// `path`, `name` and `platforms` are read by the generator; everything else
// becomes route.meta. `platforms` is what makes a page app-only or web-only
// — a page the current target does not list is left out of the table (and,
// on Flutter, never built into a chunk).
import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@vue/compiler-sfc';

export type Platform = 'app' | 'web';

export interface PageRoute {
  /** Absolute path of the .vue file. */
  file: string;
  /** Route path ('/comp/button'). */
  path: string;
  name: string;
  /** Chunk id used by `fjs build --pages` and the dev server. */
  chunk: string;
  meta: Record<string, unknown>;
  platforms: Platform[];
}

const RESERVED = new Set(['path', 'name', 'platforms', 'meta']);

function kebab(segment: string): string {
  return segment
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
}

/** `[id]` -> `:id`, `[...rest]` -> `*`, everything else kebab-cased. */
function routeSegment(segment: string): string {
  const dynamic = /^\[(\.\.\.)?([^\]]+)\]$/.exec(segment);
  if (dynamic) return dynamic[1] ? '*' : ':' + dynamic[2];
  return kebab(segment);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.vue')) out.push(full);
  }
  return out.sort();
}

/** Reads the <route> block. Returns an empty object when there is none. */
function routeBlock(file: string): Record<string, unknown> {
  const source = fs.readFileSync(file, 'utf8');
  if (!source.includes('<route')) return {};
  const { descriptor } = parse(source, { filename: path.basename(file) });
  const block = descriptor.customBlocks.find((b) => b.type === 'route');
  if (!block) return {};
  const text = block.content.trim();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch (e) {
    throw new Error(
      `${path.relative(process.cwd(), file)}: <route> block is not valid JSON — ${
        e instanceof Error ? e.message : e
      }`,
    );
  }
}

export function pagesDir(root: string): string {
  return path.join(root, 'src', 'pages');
}

/** Scans the project's pages directory. Order is deep-first alphabetical,
 * which keeps generated tables stable across machines. */
export function scanPages(root: string): PageRoute[] {
  const dir = pagesDir(root);
  if (!fs.existsSync(dir)) return [];
  return walk(dir).map((file) => {
    const rel = path.relative(dir, file).replace(/\\/g, '/');
    // `about.app.vue` / `about.web.vue`: filename shorthand for platforms
    const suffix = /\.(app|web)\.vue$/.exec(rel);
    const bare = rel.replace(/\.(app|web)\.vue$/, '').replace(/\.vue$/, '');
    const segments = bare.split('/').filter(Boolean);
    if (segments[segments.length - 1] === 'index') segments.pop();
    const routePath = '/' + segments.map(routeSegment).join('/');
    const normalized = routePath === '/' ? '/' : routePath.replace(/\/$/, '');

    const block = routeBlock(file);
    const meta: Record<string, unknown> = { ...((block.meta as object) ?? {}) };
    for (const [key, value] of Object.entries(block)) {
      if (!RESERVED.has(key)) meta[key] = value;
    }
    const declared = block.platforms as Platform[] | undefined;
    const platforms: Platform[] =
      declared ?? (suffix ? [suffix[1] as Platform] : ['app', 'web']);

    const finalPath = (block.path as string | undefined) ?? normalized;
    const name =
      (block.name as string | undefined) ??
      (finalPath === '/'
        ? 'index'
        : finalPath.replace(/^\//, '').replace(/[/:*]/g, '-'));
    return {
      file,
      path: finalPath,
      name,
      chunk: name,
      meta,
      platforms,
    };
  });
}

export function pagesFor(root: string, platform: Platform): PageRoute[] {
  return scanPages(root).filter((page) => page.platforms.includes(platform));
}

/** Source of the generated 'fjs/pages' module.
 *
 * `inline` (single-bundle Flutter builds and `fjs dev`) imports every page
 * straight into the bundle and registers it, so the router never asks the
 * host to load a chunk. Split builds (`--pages`) emit chunk ids instead;
 * web builds emit dynamic imports, which esbuild turns into one chunk per
 * page — the same shape, one platform over. */
export function routeTableSource(
  pages: PageRoute[],
  platform: Platform,
  inline = false,
): string {
  const head: string[] = ['// generated by fjs — do not edit'];
  const entries: string[] = [];
  pages.forEach((page, i) => {
    const base = `path: ${JSON.stringify(page.path)}, name: ${JSON.stringify(
      page.name,
    )}, meta: ${JSON.stringify(page.meta)}`;
    if (platform === 'web') {
      entries.push(
        `  { ${base}, component: () => import(${JSON.stringify(page.file)}) },`,
      );
    } else if (inline) {
      head.push(`import __p${i} from ${JSON.stringify(page.file)};`);
      head.push(`definePage(${JSON.stringify(page.path)}, __p${i});`);
      entries.push(`  { ${base} },`);
    } else {
      entries.push(`  { ${base}, chunk: ${JSON.stringify(page.chunk)} },`);
    }
  });
  if (inline && platform === 'app') {
    head.splice(1, 0, "import { definePage } from 'fjs/router';");
  }
  return `${head.join('\n')}\nexport const routes = [\n${entries.join(
    '\n',
  )}\n];\nexport default routes;\n`;
}

/** Entry source for one page chunk (`fjs build --pages`). */
export function pageChunkSource(page: PageRoute): string {
  return (
    "import { definePage } from 'fjs/router';\n" +
    `import Page from ${JSON.stringify(page.file)};\n` +
    `definePage(${JSON.stringify(page.path)}, Page);\n`
  );
}
