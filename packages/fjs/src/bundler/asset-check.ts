// Build-time check for local `src` typos.
//
// The generated types (project/assets.ts) answer "what have I got?"; they
// cannot answer "did I spell it right". `FjsImageSrc` is
// `"/images/x.png" | (string & {})`, and that second half — the one that
// keeps http URLs, imported assets and template strings assignable — makes
// TypeScript accept every string, typo included. So the spelling check has
// to live somewhere else, and this is it (specs/018-src-hints-and-html-dir).
//
// Only STATIC attributes are looked at: `<image src="/images/x.png">`, never
// `:src="expr"`. A page that builds its src at runtime is unknowable here,
// and a warning that fires on correct code would train people to ignore the
// channel. Missing a dynamic typo is the accepted cost.
import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@vue/compiler-sfc';
import type { PageRoute } from '../project/pages.js';
import { scanLocalAssets, type LocalAssets } from '../project/assets.js';

interface AttributeNode {
  type: 6;
  name?: string;
  value?: { content?: string };
}

interface TemplateNode {
  type: number;
  tag?: string;
  props?: { type: number; name?: string; value?: { content?: string } }[];
  children?: TemplateNode[];
}

/** Which table a tag's src is checked against. */
const CHECKED_TAGS: Record<string, 'images' | 'html'> = {
  image: 'images',
  'web-view': 'html',
};

/** Levenshtein distance, capped: only used to name a likely intended file. */
function distance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let prev = Array.from({ length: cols }, (_, i) => i);
  for (let i = 1; i < rows; i++) {
    const row = [i];
    for (let j = 1; j < cols; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[cols - 1];
}

/** The known path closest to [src], when one is close enough to be worth
 * naming. A quarter of the string may differ — beyond that a suggestion is
 * noise rather than help. */
function nearest(src: string, known: string[]): string | null {
  let best: string | null = null;
  let bestScore = Infinity;
  for (const candidate of known) {
    const score = distance(src, candidate);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  if (best == null || bestScore > Math.max(2, Math.ceil(src.length / 4))) return null;
  return best;
}

function walk(node: TemplateNode, visit: (node: TemplateNode) => void): void {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

/** The static local `src` values a page writes, tag by tag. */
function staticSources(file: string): { tag: string; src: string }[] {
  const found: { tag: string; src: string }[] = [];
  let source: string;
  try {
    source = fs.readFileSync(file, 'utf8');
  } catch {
    return found;
  }
  const { descriptor } = parse(source, { filename: file });
  const root = descriptor.template?.ast as TemplateNode | undefined;
  if (!root) return found;
  walk(root, (node) => {
    const tag = node.tag ?? '';
    if (!(tag in CHECKED_TAGS)) return;
    for (const prop of node.props ?? []) {
      // type 6 is a plain attribute; a `:src` binding is type 7 and skipped
      if (prop.type !== 6 || prop.name !== 'src') continue;
      const src = (prop as AttributeNode).value?.content ?? '';
      if (src.startsWith('/')) found.push({ tag, src });
    }
  });
  return found;
}

export interface AssetSrcWarning {
  file: string;
  tag: string;
  src: string;
  suggestion: string | null;
  text: string;
}

export function analyzeAssetSources(
  root: string,
  pages: PageRoute[],
  assets: LocalAssets = scanLocalAssets(root),
): AssetSrcWarning[] {
  const warnings: AssetSrcWarning[] = [];
  for (const page of pages) {
    for (const { tag, src } of staticSources(page.file)) {
      const kind = CHECKED_TAGS[tag];
      const known = assets[kind];
      // A src with a query or hash is still one file underneath.
      const clean = src.split(/[?#]/)[0];
      if (known.includes(clean)) continue;
      const rel = path.relative(root, page.file).replace(/\\/g, '/');
      const suggestion = nearest(clean, known);
      const where = kind === 'images' ? 'public/' : 'html/';
      warnings.push({
        file: page.file,
        tag,
        src,
        suggestion,
        text:
          `[fjs assets] ${rel}: <${tag} src="${src}"> — no such file in ` +
          `${where}.` +
          (suggestion ? ` Did you mean "${suggestion}"?` : ''),
      });
    }
  }
  return warnings;
}

/** The same, as the plain strings a build prints. */
export function assetSourceWarnings(
  root: string,
  pages: PageRoute[],
  assets?: LocalAssets,
): string[] {
  return analyzeAssetSources(root, pages, assets).map((w) => w.text);
}
