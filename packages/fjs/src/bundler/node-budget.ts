// Static first-frame node budget checks for Vue pages.
//
// This deliberately evaluates only a tiny, side-effect-free subset of script
// setup: literals, ref(literal), const arrays and computed(Array.from()). A
// build-time lint must never run user page code just to get a nicer number.
import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@vue/compiler-sfc';
import type { PageRoute } from '../project/pages.js';
import { readConfig } from '../project/config.js';

export const DEFAULT_NODE_BUDGET = 500;

type Fact =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'array'; length: number };

type Env = Map<string, Fact>;

interface DirectiveNode {
  type: number;
  name?: string;
  arg?: { content?: string };
  exp?: { content?: string };
  forParseResult?: { source?: { content?: string } };
}

interface TemplateNode {
  type: number;
  tag?: string;
  tagType?: number;
  props?: DirectiveNode[];
  children?: TemplateNode[];
}

interface ComponentImport {
  name: string;
  file: string;
}

interface EstimateContext {
  root: string;
  visiting: Set<string>;
}

export interface NodeBudgetWarning {
  file: string;
  nodes: number;
  budget: number;
  text: string;
}

function configuredBudget(root: string): number {
  const raw = readConfig(root).performance?.nodeBudget;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : DEFAULT_NODE_BUDGET;
}

export function firstFrameNodeWarnings(
  root: string,
  pages: PageRoute[],
  budget = configuredBudget(root),
): string[] {
  if (budget <= 0) return [];
  return analyzePageNodes(root, pages, budget).map((w) => w.text);
}

export function analyzePageNodes(
  root: string,
  pages: PageRoute[],
  budget = configuredBudget(root),
): NodeBudgetWarning[] {
  if (budget <= 0) return [];
  const ctx: EstimateContext = { root, visiting: new Set() };
  const warnings: NodeBudgetWarning[] = [];
  for (const page of pages) {
    const nodes = estimateSfc(page.file, ctx, new Map());
    if (nodes <= budget) continue;
    const rel = path.relative(root, page.file).replace(/\\/g, '/');
    warnings.push({
      file: page.file,
      nodes,
      budget,
      text:
        `[fjs perf] ${rel} first frame renders about ${nodes} nodes ` +
        `(budget ${budget}). Prefer list-view/windowing or reduce default rows.`,
    });
  }
  return warnings;
}

function estimateSfc(file: string, ctx: EstimateContext, props: Env): number {
  const real = fs.realpathSync(file);
  if (ctx.visiting.has(real)) return 0;
  ctx.visiting.add(real);
  try {
    const source = fs.readFileSync(file, 'utf8');
    const { descriptor, errors } = parse(source, { filename: path.basename(file) });
    if (errors.length || !descriptor.template?.ast) return 0;

    const env = new Map(props);
    for (const [name, fact] of scriptFacts(descriptor.script?.content ?? '')) env.set(name, fact);
    for (const [name, fact] of scriptFacts(descriptor.scriptSetup?.content ?? '')) env.set(name, fact);
    const imports = componentImports(
      [descriptor.script?.content, descriptor.scriptSetup?.content].filter(Boolean).join('\n'),
      path.dirname(file),
    );
    const byName = new Map(imports.map((item) => [item.name, item.file]));

    return estimateChildren(descriptor.template.ast as TemplateNode, ctx, env, byName);
  } finally {
    ctx.visiting.delete(real);
  }
}

function estimateChildren(
  node: TemplateNode,
  ctx: EstimateContext,
  env: Env,
  components: Map<string, string>,
): number {
  let total = 0;
  let i = 0;
  while (i < (node.children?.length ?? 0)) {
    const child = node.children![i];
    const ifDir = directive(child, 'if');
    if (ifDir) {
      const group: TemplateNode[] = [child];
      let j = i + 1;
      while (j < node.children!.length) {
        const next = node.children![j];
        if (!directive(next, 'else-if') && !directive(next, 'else')) break;
        group.push(next);
        j++;
      }
      total += estimateBranch(group, ctx, env, components);
      i = j;
      continue;
    }
    if (!directive(child, 'else-if') && !directive(child, 'else')) {
      total += estimateNode(child, ctx, env, components);
    }
    i++;
  }
  return total;
}

function estimateBranch(
  nodes: TemplateNode[],
  ctx: EstimateContext,
  env: Env,
  components: Map<string, string>,
): number {
  for (const node of nodes) {
    const dir = directive(node, 'if') ?? directive(node, 'else-if');
    if (!dir) return estimateNode(node, ctx, env, components);
    const value = evalCondition(dir.exp?.content ?? '', env);
    if (value === true) return estimateNode(node, ctx, env, components);
    if (value === false) continue;
    break;
  }
  return Math.max(...nodes.map((node) => estimateNode(node, ctx, env, components)), 0);
}

function estimateNode(
  node: TemplateNode,
  ctx: EstimateContext,
  env: Env,
  components: Map<string, string>,
): number {
  if (node.type !== 1) return estimateChildren(node, ctx, env, components);

  const times = loopCount(node, env) ?? 1;
  const single = estimateSingleNode(node, ctx, env, components);
  return single * times;
}

function estimateSingleNode(
  node: TemplateNode,
  ctx: EstimateContext,
  env: Env,
  components: Map<string, string>,
): number {
  if (node.tag === 'template') return estimateChildren(node, ctx, env, components);

  const dynamicTag = node.tag === 'component' ? dynamicComponentTag(node, env) : null;
  if (dynamicTag) {
    return 1 + estimateChildren(node, ctx, env, components);
  }

  if (node.tag && components.has(node.tag)) {
    const childProps = boundProps(node, env);
    return estimateSfc(components.get(node.tag)!, ctx, childProps);
  }

  if (node.tagType === 1 && node.tag && /^[A-Z]/.test(node.tag)) return 0;
  return 1 + estimateChildren(node, ctx, env, components);
}

function directive(node: TemplateNode, name: string): DirectiveNode | undefined {
  return node.props?.find((prop) => prop.type === 7 && prop.name === name);
}

function loopCount(node: TemplateNode, env: Env): number | null {
  const dir = directive(node, 'for');
  const source = dir?.forParseResult?.source?.content ?? dir?.exp?.content?.split(/\s+in\s+/).pop();
  if (!source) return null;
  const fact = evalFact(source, env);
  return fact?.kind === 'array' ? fact.length : null;
}

function dynamicComponentTag(node: TemplateNode, env: Env): string | null {
  const is = node.props?.find(
    (prop) => prop.type === 7 && prop.name === 'bind' && prop.arg?.content === 'is',
  );
  const fact = is?.exp?.content ? evalFact(is.exp.content, env) : null;
  return fact?.kind === 'string' ? fact.value : null;
}

function boundProps(node: TemplateNode, env: Env): Env {
  const out: Env = new Map();
  for (const prop of node.props ?? []) {
    if (prop.type !== 7 || prop.name !== 'bind' || !prop.arg?.content || !prop.exp?.content) continue;
    const fact = evalFact(prop.exp.content, env);
    if (fact) out.set(prop.arg.content, fact);
  }
  return out;
}

function evalCondition(expr: string, env: Env): boolean | null {
  const trimmed = expr.trim();
  if (trimmed.startsWith('!')) {
    const value = evalCondition(trimmed.slice(1), env);
    return value == null ? null : !value;
  }
  const fact = evalFact(trimmed, env);
  return fact?.kind === 'boolean' ? fact.value : null;
}

function evalFact(expr: string, env: Env): Fact | null {
  const trimmed = stripParens(stripTsSuffix(expr.trim()));
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) return { kind: 'number', value: Number(trimmed) };
  if (trimmed === 'true' || trimmed === 'false') return { kind: 'boolean', value: trimmed === 'true' };
  const string = /^(?:'([^']*)'|"([^"]*)")$/.exec(trimmed);
  if (string) return { kind: 'string', value: string[1] ?? string[2] ?? '' };
  if (trimmed.startsWith('[') && matchingEnd(trimmed, 0, '[', ']') === trimmed.length - 1) {
    return { kind: 'array', length: splitTopLevel(trimmed.slice(1, -1), ',').filter(Boolean).length };
  }
  const from = arrayFromLength(trimmed, env);
  if (from) return from;
  const ref = /^ref(?:<[\s\S]*>)?\(([\s\S]*)\)$/.exec(trimmed);
  if (ref) return evalFact(ref[1], env);
  const computed = /^computed\(\s*\(\s*\)\s*=>\s*([\s\S]*)\)$/.exec(trimmed);
  if (computed) return evalFact(computed[1], env);
  const value = /^([A-Za-z_$][\w$]*)\.value$/.exec(trimmed);
  if (value) return env.get(value[1]) ?? null;
  const ident = /^[A-Za-z_$][\w$]*$/.exec(trimmed);
  if (ident) return env.get(trimmed) ?? null;
  return null;
}

function arrayFromLength(expr: string, env: Env): Fact | null {
  const match = /^Array\.from\(\s*\{\s*length\s*:\s*([\s\S]*?)\s*\}(?:\s*,[\s\S]*)?\)$/.exec(expr);
  if (!match) return null;
  const length = evalFact(match[1], env);
  return length?.kind === 'number' ? { kind: 'array', length: length.value } : null;
}

function scriptFacts(source: string): Env {
  const env: Env = new Map();
  for (const decl of constDeclarations(stripComments(source))) {
    const fact = evalFact(decl.init, env);
    if (fact) env.set(decl.name, fact);
  }
  return env;
}

function constDeclarations(source: string): { name: string; init: string }[] {
  const out: { name: string; init: string }[] = [];
  const re = /\bconst\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const start = re.lastIndex;
    const end = statementEnd(source, start);
    if (end === -1) break;
    out.push({ name: match[1], init: source.slice(start, end).trim() });
    re.lastIndex = end + 1;
  }
  return out;
}

function componentImports(source: string, dir: string): ComponentImport[] {
  const out: ComponentImport[] = [];
  const re = /\bimport\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+\.vue)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const spec = match[2];
    if (!spec.startsWith('.') && !spec.startsWith('/')) continue;
    const file = path.resolve(dir, spec);
    if (fs.existsSync(file)) out.push({ name: match[1], file });
  }
  return out;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function stripTsSuffix(expr: string): string {
  return expr.replace(/\s+as\s+const\s*$/m, '').replace(/,\s*$/, '').trim();
}

function stripParens(expr: string): string {
  let out = expr;
  while (out.startsWith('(') && matchingEnd(out, 0, '(', ')') === out.length - 1) {
    out = out.slice(1, -1).trim();
  }
  return out;
}

function statementEnd(source: string, start: number): number {
  let single = false;
  let double = false;
  let template = false;
  const stack: string[] = [];
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    const prev = source[i - 1];
    if (single) {
      if (ch === "'" && prev !== '\\') single = false;
      continue;
    }
    if (double) {
      if (ch === '"' && prev !== '\\') double = false;
      continue;
    }
    if (template) {
      if (ch === '`' && prev !== '\\') template = false;
      continue;
    }
    if (ch === "'") single = true;
    else if (ch === '"') double = true;
    else if (ch === '`') template = true;
    else if (ch === '(' || ch === '[' || ch === '{') stack.push(ch);
    else if (ch === ')' || ch === ']' || ch === '}') stack.pop();
    else if (ch === ';' && stack.length === 0) return i;
  }
  return -1;
}

function matchingEnd(source: string, start: number, open: string, close: string): number {
  let depth = 0;
  let single = false;
  let double = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    const prev = source[i - 1];
    if (single) {
      if (ch === "'" && prev !== '\\') single = false;
      continue;
    }
    if (double) {
      if (ch === '"' && prev !== '\\') double = false;
      continue;
    }
    if (ch === "'") single = true;
    else if (ch === '"') double = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return i;
  }
  return -1;
}

function splitTopLevel(source: string, sep: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let single = false;
  let double = false;
  const stack: string[] = [];
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const prev = source[i - 1];
    if (single) {
      if (ch === "'" && prev !== '\\') single = false;
      continue;
    }
    if (double) {
      if (ch === '"' && prev !== '\\') double = false;
      continue;
    }
    if (ch === "'") single = true;
    else if (ch === '"') double = true;
    else if (ch === '(' || ch === '[' || ch === '{') stack.push(ch);
    else if (ch === ')' || ch === ']' || ch === '}') stack.pop();
    else if (ch === sep && stack.length === 0) {
      parts.push(source.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(source.slice(start).trim());
  return parts;
}
