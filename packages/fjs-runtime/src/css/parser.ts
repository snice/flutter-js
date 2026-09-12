// Minimal CSS subset parser for Vue SFC <style> blocks.
//
// Supported: class/tag/universal selectors, descendant (space) and child (>)
// combinators, :deep(...) / ::v-deep(...) / :global(...) wrappers, the
// `:active` pseudo-class on the subject compound, comments. Unsupported
// constructs (at-rules, attribute selectors, other pseudo classes, id
// selectors) make the offending selector (or block) be skipped with a
// one-time warning instead of failing the build.
//
// Declaration keys are camelized (font-size -> fontSize) and values are
// normalized: pure numbers and px/rem lengths become JS numbers so the
// Dart side keeps receiving the same shapes as the inline style API.

export type Combinator = 'descendant' | 'child';

export interface Compound {
  tag: string | null; // null = universal ('*')
  classes: string[];
  /** Structural position among the parent's element children (raw-text
   * siblings excluded, see StyleEngine). Set by `:first-child`/`:last-child`. */
  first?: boolean;
  last?: boolean;
}

export interface Selector {
  compounds: Compound[]; // source order; the last one is the subject
  combinators: Combinator[]; // combinators[i] joins compounds[i] and [i+1]
  deep: boolean; // matched via :deep() — scope checked on an ancestor
  active: boolean; // subject carries :active — only applies while pressed
  hover: boolean; // subject carries :hover — only applies while hovered
  specificity: number; // classes*10 + tags (+10 per pseudo-class)
}

export interface CssRule {
  selectors: Selector[];
  decls: Record<string, unknown>;
  order: number; // source order for the cascade
  scope: string | null; // 'data-v-xxx' for scoped rules, null = global
  /** Set only for rules parsed from inside an `@media` block (spec 043).
   * Matched against the viewport at style time; a rule whose condition
   * fails never enters the cascade. */
  media?: MediaCondition;
}

// ---- @media conditions ------------------------------------------------------
//
// Supported (the two-end common subset, see css-compat.md): media type
// `screen` / `all` (an omitted type means any; `only` is tolerated and
// ignored), features min/max-width, min/max-height, width, height and
// `orientation: portrait|landscape`, combined with `and` and `,` (or).
// Anything else — `not`, an unknown feature, a non-length value — makes the
// WHOLE block drop with a one-time warning. On web the browser evaluates
// the block natively, so a dropped block is exactly the two-end divergence
// the warning exists to surface (constitution V).

export interface MediaFeature {
  prop: 'width' | 'height';
  op: 'min' | 'max' | null; // null = exact match, `(width: 600px)`
  value: number;
}

export interface MediaQueryBranch {
  /** null = the query named no type (`@media (min-width: …)`), which like
   * CSS `all` matches regardless. Only screen media exist here. */
  type: 'screen' | 'all' | null;
  features: Array<MediaFeature | { prop: 'orientation'; keyword: 'portrait' | 'landscape' }>;
}

/** OR over branches; every feature within a branch must hold. */
export type MediaCondition = MediaQueryBranch[];

export function mediaMatches(
  condition: MediaCondition,
  width: number,
  height: number,
): boolean {
  return condition.some((branch) => {
    // `type` is 'screen' | 'all' | null and all three match — the only
    // medium that exists here is the screen
    for (const f of branch.features) {
      if (f.prop === 'orientation') {
        // CSS: portrait is height >= width (a square viewport is portrait)
        const portrait = height >= width;
        if ((f.keyword === 'portrait') !== portrait) return false;
      } else if (f.op === 'min') {
        if ((f.prop === 'width' ? width : height) < f.value) return false;
      } else if (f.op === 'max') {
        if ((f.prop === 'width' ? width : height) > f.value) return false;
      } else if ((f.prop === 'width' ? width : height) !== f.value) {
        return false;
      }
    }
    return true;
  });
}

/** Parses the text after `@media` into a condition, or null when something
 * unsupported appeared (the caller drops the block; warnOnce already fired). */
export function parseMediaCondition(text: string): MediaCondition | null {
  let out: MediaCondition | null = null;
  for (const raw of splitTopLevel(text, ',')) {
    const branch = parseMediaBranch(raw.trim());
    if (branch === null) return null;
    (out ??= []).push(branch);
  }
  if (out === null || out.length === 0) {
    warnOnce(`@media "${text.trim()}" has no condition, skipped`);
    return null;
  }
  return out;
}

function parseMediaBranch(text: string): MediaQueryBranch | null {
  if (/^only\s+/i.test(text)) text = text.replace(/^only\s+/i, '');
  // tokenize at paren depth 0: terms (a type word or a `(feature: value)`
  // group) separated by the word `and`. Juxtaposed terms without `and`,
  // a dangling `and`, or `and or` style combinations are unsupported
  // grammar — dropped rather than guessed at.
  const tokens: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    const ch = i === text.length ? ' ' : text[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && /\s/.test(ch)) {
      if (i > start) tokens.push(text.slice(start, i));
      start = i + 1;
    }
  }
  const branch: MediaQueryBranch = { type: null, features: [] };
  let expectTerm = true;
  for (const token of tokens) {
    if (/^and$/i.test(token)) {
      if (expectTerm) {
        warnOnce(`@media "${text.trim()}" uses unsupported syntax, skipped`);
        return null;
      }
      expectTerm = true;
      continue;
    }
    if (!expectTerm) {
      warnOnce(`@media "${text.trim()}" uses unsupported syntax, skipped`);
      return null;
    }
    expectTerm = false;
    if (token.startsWith('(')) {
      if (!token.endsWith(')')) {
        warnOnce(`@media "${text.trim()}" uses unsupported syntax, skipped`);
        return null;
      }
      const body = token.slice(1, -1).trim();
      const idx = body.indexOf(':');
      if (idx <= 0) {
        warnOnce(`@media "${text.trim()}" feature "(${body})" is not supported, skipped`);
        return null;
      }
      const name = body.slice(0, idx).trim().toLowerCase();
      const value = body.slice(idx + 1).trim();
      if (name === 'orientation') {
        if (value !== 'portrait' && value !== 'landscape') {
          warnOnce(`@media "${text.trim()}" orientation "${value}" is not supported, skipped`);
          return null;
        }
        branch.features.push({ prop: 'orientation', keyword: value });
        continue;
      }
      const m = /^(min|max)?-?(width|height)$/.exec(name);
      if (!m) {
        warnOnce(`@media "${text.trim()}" feature "${name}" is not supported, skipped`);
        return null;
      }
      const num = /^(\d+(?:\.\d+)?)(?:px)?$/.exec(value);
      if (!num) {
        warnOnce(`@media "${text.trim()}" value "${value}" for "${name}" is not a px length, skipped`);
        return null;
      }
      branch.features.push({
        prop: m[2] as 'width' | 'height',
        op: (m[1] as 'min' | 'max' | undefined) ?? null,
        value: parseFloat(num[1]),
      });
      continue;
    }
    // a bare word is a media type; only screen/all exist here
    if (branch.type === null && /^(screen|all)$/i.test(token)) {
      branch.type = token.toLowerCase() as 'screen' | 'all';
      continue;
    }
    warnOnce(`@media "${text.trim()}" uses unsupported syntax "${token}", skipped`);
    return null;
  }
  if (expectTerm) {
    warnOnce(`@media "${text.trim()}" has no condition, skipped`);
    return null;
  }
  return branch;
}

const warned = new Set<string>();
/** The repo's rule: never drop something silently (constitution V). */
export function warnOnce(msg: string): void {
  if (warned.has(msg)) return;
  warned.add(msg);
  console.warn(`[fjs css] ${msg}`);
}

export function parseStylesheet(
  css: string,
  scope: string | null,
  startOrder: number,
): CssRule[] {
  const text = stripComments(css);
  const rules: CssRule[] = [];
  let order = startOrder;
  let i = 0;
  while (i < text.length) {
    const brace = text.indexOf('{', i);
    if (brace < 0) break;
    const selectorText = text.slice(i, brace).trim();
    const close = matchBrace(text, brace);
    const block = text.slice(brace + 1, close < 0 ? text.length : close);
    i = close < 0 ? text.length : close + 1;
    if (selectorText.startsWith('@')) {
      if (/^@media\b/.test(selectorText)) {
        const condition = parseMediaCondition(selectorText.slice('@media'.length).trim());
        if (condition !== null) {
          parseMediaBlock(block, scope, condition, rules, () => order++);
        }
      } else {
        warnOnce(`at-rule "${selectorText.split(/[\s{]/)[0]}" is not supported, skipped`);
      }
      continue;
    }
    const decls = parseDeclarations(block);
    if (Object.keys(decls).length === 0) continue;
    const selectors: Selector[] = [];
    for (const part of selectorText.split(',')) {
      const sel = parseSelector(part.trim());
      if (sel) selectors.push(sel);
    }
    if (selectors.length === 0) continue;
    rules.push({ selectors, decls, order: order++, scope });
  }
  return rules;
}

/** Parses the RULE SETS inside an `@media` block (a plain selector block's
 * content is declarations — this one is not called for those). Each rule
 * the block yields carries the block's condition. The order callback hands
 * out the next source-order number so media and plain rules interleave in
 * one sequence; nested at-rules warn and drop (constitution V). */
function parseMediaBlock(
  block: string,
  scope: string | null,
  media: MediaCondition,
  rules: CssRule[],
  nextOrder: () => number,
): void {
  let i = 0;
  while (i < block.length) {
    const brace = block.indexOf('{', i);
    if (brace < 0) break;
    const selectorText = block.slice(i, brace).trim();
    const close = matchBrace(block, brace);
    const declsText = block.slice(brace + 1, close < 0 ? block.length : close);
    i = close < 0 ? block.length : close + 1;
    if (selectorText.startsWith('@')) {
      warnOnce(`at-rule "${selectorText.split(/[\s{]/)[0]}" nested inside @media is not supported, skipped`);
      continue;
    }
    const decls = parseDeclarations(declsText);
    if (Object.keys(decls).length === 0) continue;
    const selectors: Selector[] = [];
    for (const part of selectorText.split(',')) {
      const sel = parseSelector(part.trim());
      if (sel) selectors.push(sel);
    }
    if (selectors.length === 0) continue;
    rules.push({ selectors, decls, order: nextOrder(), scope, media });
  }
}

/** Parses an inline `style="color:red"` attribute value into a style object. */
export function parseInlineCss(css: string): Record<string, unknown> {
  return parseDeclarations(stripComments(css));
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function matchBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parseDeclarations(block: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const decl of splitTopLevel(block, ';')) {
    const idx = decl.indexOf(':');
    if (idx <= 0) continue;
    const rawKey = decl.slice(0, idx).trim();
    let value = decl.slice(idx + 1).trim();
    if (!rawKey || !value) continue;
    if (value.endsWith('!important')) {
      value = value.slice(0, -'!important'.length).trim();
    }
    if (!value) continue;
    if (rawKey.startsWith('--')) {
      // CSS custom property: kept verbatim, value stays a raw string (it is
      // substituted textually into var() references later)
      out[rawKey] = value;
      continue;
    }
    const key = camelize(rawKey);
    out[key] = normalizeValue(key, value);
  }
  return out;
}

/** Splits on `sep` occurrences that are not inside parentheses. */
function splitTopLevel(text: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === sep && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function camelize(key: string): string {
  return key
    .replace(/^-(?:webkit|moz|ms|o)-/, '')
    .replace(/-+([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Converts a substituted CSS value into the shape the bridge expects
 * (numbers for lengths, strings otherwise). Exported for var() resolution. */
export function normalizeValue(key: string, raw: string): unknown {
  const v = raw.trim();
  // keep lineHeight units so Dart can tell multipliers (1.5) from
  // absolute heights ("24px") apart
  if (key === 'lineHeight') return v;
  if (/^-?\d+(\.\d+)?px$/.test(v)) return parseFloat(v);
  if (/^-?\d+(\.\d+)?rem$/.test(v)) return parseFloat(v) * 16;
  if (/^-?\d+(\.\d+)?$/.test(v)) return parseFloat(v);
  return v;
}

export function parseSelector(raw: string): Selector | null {
  const { text: unwrapped, deep, global } = unwrapWrappers(raw);
  // `:active` / `:hover` are the two pseudo-classes with a runtime state
  // behind them. Only the subject compound can carry one: an ancestor's
  // state would have to be tracked per node pair, which neither adapter
  // does. They may stack (`.a:active:hover`).
  let active = false;
  let hover = false;
  let text = unwrapped.trim();
  for (;;) {
    if (/:active$/.test(text)) {
      active = true;
      text = text.slice(0, -':active'.length).trim();
    } else if (/:hover$/.test(text)) {
      hover = true;
      text = text.slice(0, -':hover'.length).trim();
    } else {
      break;
    }
  }
  if (/:active/.test(text)) {
    warnOnce(`selector "${raw.trim()}" puts :active on something other than its last compound, skipped`);
    return null;
  }
  if (/:hover/.test(text)) {
    warnOnce(`selector "${raw.trim()}" puts :hover on something other than its last compound, skipped`);
    return null;
  }
  // :first-child / :last-child are structural — computable for any compound
  // in the chain — so they survive into parseCompound. What is left here has
  // to be plain compound syntax.
  if (/[([:]/.test(text.replace(/:(?:first|last)-child/g, ''))) {
    warnOnce(`selector "${raw.trim()}" uses unsupported syntax (attr/pseudo/id), skipped`);
    return null;
  }
  const compounds: Compound[] = [];
  const combinators: Combinator[] = [];
  let buf = '';
  let pending: Combinator | null = null;
  const flush = () => {
    if (!buf) return;
    const compound = parseCompound(buf);
    buf = '';
    if (!compound) return;
    if (pending && compounds.length > 0) combinators.push(pending);
    pending = null;
    compounds.push(compound);
  };
  for (const ch of text) {
    if (ch === '>') {
      flush();
      pending = 'child';
    } else if (/\s/.test(ch)) {
      flush();
      if (pending == null) pending = 'descendant';
    } else {
      buf += ch;
    }
  }
  flush();
  if (compounds.length === 0) return null;
  let specificity = 0;
  let pseudos = (active ? 1 : 0) + (hover ? 1 : 0);
  for (const c of compounds) {
    specificity += c.classes.length * 10 + (c.tag ? 1 : 0);
    if (c.first) pseudos++;
    if (c.last) pseudos++;
  }
  specificity += pseudos * 10; // a pseudo-class weighs as much as a class
  return { compounds, combinators, deep, active, hover, specificity };
}

/** Unwraps :deep(...) / ::v-deep(...) / :global(...) around the selector,
 * remembering which flags were seen. `>>>` is treated as deep descendant. */
function unwrapWrappers(sel: string): { text: string; deep: boolean; global: boolean } {
  let text = sel.replace(/>>>/g, ' ');
  let deep = false;
  let global = false;
  let out = '';
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    const paren = /^(:{1,2})(?:v-deep|deep|global)\s*\(/.exec(rest);
    if (paren) {
      if (paren[0].includes('global')) global = true;
      else deep = true;
      i += paren[0].length;
      let depth = 1;
      while (i < text.length && depth > 0) {
        const ch = text[i];
        if (ch === '(') depth++;
        else if (ch === ')') {
          depth--;
          if (depth === 0) break;
        }
        out += ch;
        i++;
      }
      i++; // closing ')'
      continue;
    }
    const bare = /^::v-deep(?![\w-])\s*/.exec(rest);
    if (bare) {
      deep = true;
      i += bare[0].length;
      continue;
    }
    out += text[i];
    i++;
  }
  text = out;
  return { text, deep, global };
}

function parseCompound(text: string): Compound | null {
  const classes: string[] = [];
  let tag: string | null = null;
  let first = false;
  let last = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '.') {
      let j = i + 1;
      while (j < text.length && /[\w-]/.test(text[j])) j++;
      if (j === i + 1) return null;
      classes.push(text.slice(i + 1, j));
      i = j;
    } else if (ch === ':') {
      // structural pseudo, allowed anywhere in the compound; the pre-check
      // in parseSelector already rejected every other pseudo name
      let j = i + 1;
      while (j < text.length && /[\w-]/.test(text[j])) j++;
      const name = text.slice(i + 1, j);
      if (name === 'first-child') first = true;
      else if (name === 'last-child') last = true;
      else return null; // unreachable via parseSelector, defensive
      i = j;
    } else if (ch === '*') {
      tag = null;
      i++;
    } else if (/[A-Za-z]/.test(ch)) {
      let j = i + 1;
      while (j < text.length && /[\w-]/.test(text[j])) j++;
      tag = text.slice(i, j);
      i = j;
    } else {
      return null; // stray '#' or other unsupported char
    }
  }
  // flags are omitted when false so a plain compound deep-equals the shape
  // it always had
  return {
    tag,
    classes,
    ...(first ? { first: true } : {}),
    ...(last ? { last: true } : {}),
  };
}
