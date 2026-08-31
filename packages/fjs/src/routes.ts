// fjs routes — print the route table `fjs build` derives from src/pages.
//
// File-based routing is convention, and the usual question is "what URL did
// this file become?". This answers it from the same scanner the build uses,
// so the table can never drift from the real one.
import path from 'node:path';
import fs from 'node:fs';
import { pagesDir, scanPages, type PageRoute, type Platform } from './pages.js';

interface RoutesOptions {
  platform?: Platform;
  json: boolean;
}

export function routesCommand(argv: string[]): void {
  const opts = parseArgs(argv);
  const root = process.cwd();
  const dir = pagesDir(root);
  if (!fs.existsSync(dir)) {
    throw new Error(
      `no pages directory at ${path.relative(root, dir)} — file routing needs src/pages/*.vue`,
    );
  }

  let pages = scanPages(root);
  if (opts.platform) {
    const platform = opts.platform;
    pages = pages.filter((page) => page.platforms.includes(platform));
  }

  if (opts.json) {
    console.log(
      JSON.stringify(
        pages.map((page) => ({ ...page, file: path.relative(root, page.file) })),
        null,
        2,
      ),
    );
    return;
  }

  if (pages.length === 0) {
    console.log(opts.platform ? `no pages target ${opts.platform}` : 'no pages found');
    return;
  }

  const rows = pages.map((page) => [
    page.path,
    page.name,
    page.chunk,
    page.platforms.join(','),
    path.relative(root, page.file),
    metaSummary(page),
  ]);
  const head = ['PATH', 'NAME', 'CHUNK', 'TARGET', 'FILE', 'META'];
  const widths = head.map((_, i) => Math.max(...rows.map((r) => r[i].length), head[i].length));
  const line = (cells: string[]) =>
    cells.map((cell, i) => (i === cells.length - 1 ? cell : cell.padEnd(widths[i]))).join('  ').trimEnd();

  console.log(line(head));
  for (const row of rows) console.log(line(row));

  for (const [routePath, count] of duplicates(pages, (page) => page.path)) {
    console.log(`\nwarning: ${count} pages resolve to ${routePath} — the last one wins`);
  }
  for (const [name, count] of duplicates(pages, (page) => page.name)) {
    console.log(
      `\nwarning: ${count} pages share the name "${name}" — router.push({ name }) ` +
        `and the page chunk id are both ambiguous; set "name" in a <route> block`,
    );
  }
}

function metaSummary(page: PageRoute): string {
  const keys = Object.entries(page.meta);
  if (keys.length === 0) return '';
  return keys.map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' ');
}

function duplicates(
  pages: PageRoute[],
  key: (page: PageRoute) => string,
): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const page of pages) {
    const value = key(page);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts].filter(([, count]) => count > 1);
}

function parseArgs(argv: string[]): RoutesOptions {
  const opts: RoutesOptions = { json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') opts.json = true;
    else if (arg === '--platform') {
      const value = argv[++i];
      if (value !== 'app' && value !== 'web') {
        throw new Error('--platform takes app or web');
      }
      opts.platform = value;
    } else throw new Error(`unknown routes option: ${arg}`);
  }
  return opts;
}
