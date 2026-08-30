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
}

export interface Selector {
  compounds: Compound[]; // source order; the last one is the subject
  combinators: Combinator[]; // combinators[i] joins compounds[i] and [i+1]
  deep: boolean; // matched via :deep() — scope checked on an ancestor
  active: boolean; // subject carries :active — only applies while pressed
  specificity: number; // classes*10 + tags (+10 for :active)
}

export interface CssRule {
  selectors: Selector[];
  decls: Record<string, unknown>;
  order: number; // source order for the cascade
  scope: string | null; // 'data-v-xxx' for scoped rules, null = global
}

const warned = new Set<string>();
function warnOnce(msg: string): void {
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
      warnOnce(`at-rule "${selectorText.split(/[\s{]/)[0]}" is not supported, skipped`);
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
  // `:active` is the one pseudo-class with a state behind it. Only the
  // subject compound can carry it: an ancestor's press state would have to
  // be tracked per node pair, which neither adapter does.
  let active = false;
  let text = unwrapped.trim();
  if (/:active$/.test(text)) {
    active = true;
    text = text.slice(0, -':active'.length);
  }
  if (/:active/.test(text)) {
    warnOnce(`selector "${raw.trim()}" puts :active on something other than its last compound, skipped`);
    return null;
  }
  if (/[([:]/.test(text)) {
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
  for (const c of compounds) specificity += c.classes.length * 10 + (c.tag ? 1 : 0);
  if (active) specificity += 10; // a pseudo-class weighs as much as a class
  return { compounds, combinators, deep, active, specificity };
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
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '.') {
      let j = i + 1;
      while (j < text.length && /[\w-]/.test(text[j])) j++;
      if (j === i + 1) return null;
      classes.push(text.slice(i + 1, j));
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
  return { tag, classes };
}
