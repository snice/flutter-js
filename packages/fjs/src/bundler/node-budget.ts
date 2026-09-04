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
  type: 7;
  name?: string;
  arg?: { content?: string };
  exp?: { content?: string };
  forParseResult?: { source?: { content?: string } };
}

interface AttributeNode {
  type: 6;
  name?: string;
  value?: { content?: string };
}

type TemplateProp = AttributeNode | DirectiveNode;

interface TemplateNode {
  type: number;
  tag?: string;
  tagType?: number;
  props?: TemplateProp[];
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

interface SfcAnalysis {
  nodes: number;
  textWarnings: NodeBudgetWarning[];
}

interface StyleRule {
  selector: string;
  tag: string | null;
  classes: string[];
  declarations: StaticStyle;
}

interface ParentStyle {
  selector: string;
  style: StaticStyle;
}

type StaticStyle = Map<string, string>;

export interface NodeBudgetWarning {
  file: string;
  nodes: number;
  budget: number;
  text: string;
  kind?: 'node-budget' | 'text-layout';
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
    const analysis = analyzeSfc(page.file, ctx, new Map());
    if (analysis.nodes > budget) {
      const rel = path.relative(root, page.file).replace(/\\/g, '/');
      warnings.push({
        file: page.file,
        nodes: analysis.nodes,
        budget,
        kind: 'node-budget',
        text:
          `[fjs perf] ${rel} first frame renders about ${analysis.nodes} nodes ` +
          `(budget ${budget}). Prefer list-view/windowing or reduce default rows.`,
      });
    }
    const seen = new Set<string>();
    for (const warning of analysis.textWarnings) {
      if (seen.has(warning.text)) continue;
      seen.add(warning.text);
      warnings.push(warning);
    }
  }
  return warnings;
}

function estimateSfc(file: string, ctx: EstimateContext, props: Env): number {
  return analyzeSfc(file, ctx, props).nodes;
}

function analyzeSfc(file: string, ctx: EstimateContext, props: Env): SfcAnalysis {
  const real = fs.realpathSync(file);
  if (ctx.visiting.has(real)) return { nodes: 0, textWarnings: [] };
  ctx.visiting.add(real);
  try {
    const source = fs.readFileSync(file, 'utf8');
    const { descriptor, errors } = parse(source, { filename: path.basename(file) });
    if (errors.length || !descriptor.template?.ast) return { nodes: 0, textWarnings: [] };

    const env = new Map(props);
    for (const [name, fact] of scriptFacts(descriptor.script?.content ?? '')) env.set(name, fact);
    for (const [name, fact] of scriptFacts(descriptor.scriptSetup?.content ?? '')) env.set(name, fact);
    const imports = componentImports(
      [descriptor.script?.content, descriptor.scriptSetup?.content].filter(Boolean).join('\n'),
      path.dirname(file),
    );
    const byName = new Map(imports.map((item) => [item.name, item.file]));
    const rules = descriptor.styles.flatMap((style) => parseStyleRules(style.content));

    return {
      nodes: estimateChildren(descriptor.template.ast as TemplateNode, ctx, env, byName),
      textWarnings: collectTextLayoutWarnings(
        file,
        descriptor.template.ast as TemplateNode,
        ctx,
        env,
        byName,
        rules,
        null,
        new Set(),
      ),
    };
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

function collectTextLayoutWarnings(
  file: string,
  node: TemplateNode,
  ctx: EstimateContext,
  env: Env,
  components: Map<string, string>,
  rules: StyleRule[],
  parent: ParentStyle | null,
  seen: Set<string>,
): NodeBudgetWarning[] {
  if (node.type !== 1) {
    return collectTextLayoutChildren(file, node, ctx, env, components, rules, parent, seen);
  }

  const warnings: NodeBudgetWarning[] = [];
  const style = resolveStaticStyle(node, env, rules);
  const selector = nodeSelector(node, env);

  if (node.tag === 'text') {
    warnings.push(...textOwnHeightWarnings(ctx.root, file, selector, style, seen));
    if (parent) warnings.push(...parentContentHeightWarnings(ctx.root, file, parent, style, seen));
  }

  if (node.tag && components.has(node.tag)) {
    warnings.push(...analyzeSfc(components.get(node.tag)!, ctx, boundProps(node, env)).textWarnings);
  }

  const childParent = node.tag === 'template' ? parent : { selector, style };
  warnings.push(...collectTextLayoutChildren(file, node, ctx, env, components, rules, childParent, seen));
  return warnings;
}

function collectTextLayoutChildren(
  file: string,
  node: TemplateNode,
  ctx: EstimateContext,
  env: Env,
  components: Map<string, string>,
  rules: StyleRule[],
  parent: ParentStyle | null,
  seen: Set<string>,
): NodeBudgetWarning[] {
  const warnings: NodeBudgetWarning[] = [];
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
      warnings.push(
        ...collectTextLayoutBranch(file, group, ctx, env, components, rules, parent, seen),
      );
      i = j;
      continue;
    }
    if (!directive(child, 'else-if') && !directive(child, 'else')) {
      warnings.push(
        ...collectTextLayoutWarnings(file, child, ctx, env, components, rules, parent, seen),
      );
    }
    i++;
  }
  return warnings;
}

function collectTextLayoutBranch(
  file: string,
  nodes: TemplateNode[],
  ctx: EstimateContext,
  env: Env,
  components: Map<string, string>,
  rules: StyleRule[],
  parent: ParentStyle | null,
  seen: Set<string>,
): NodeBudgetWarning[] {
  const warnings: NodeBudgetWarning[] = [];
  for (const node of nodes) {
    const dir = directive(node, 'if') ?? directive(node, 'else-if');
    if (!dir) {
      warnings.push(
        ...collectTextLayoutWarnings(file, node, ctx, env, components, rules, parent, seen),
      );
      return warnings;
    }
    const value = evalCondition(dir.exp?.content ?? '', env);
    if (value === false) continue;
    warnings.push(
      ...collectTextLayoutWarnings(file, node, ctx, env, components, rules, parent, seen),
    );
    if (value === true) return warnings;
  }
  return warnings;
}

function textOwnHeightWarnings(
  root: string,
  file: string,
  selector: string,
  style: StaticStyle,
  seen: Set<string>,
): NodeBudgetWarning[] {
  const warnings: NodeBudgetWarning[] = [];
  const lineBox = flutterTextLineBox(style);
  for (const prop of ['height', 'minHeight']) {
    const raw = style.get(prop);
    const box = raw == null ? null : contentHeightAfterPadding(raw, style);
    if (box == null || box >= lineBox) continue;
    const warning = textWarning(
      root,
      file,
      `${selector}:${prop}`,
      seen,
      (rel) =>
        `[fjs perf] ${rel} text "${selector}" ${cssName(prop)} ${fmtPx(box)} ` +
        `is below Flutter line box ~${lineBox}px. Use at least ${lineBox}px ` +
        `or remove the fixed text height.`,
    );
    if (warning) warnings.push(warning);
  }
  return warnings;
}

function parentContentHeightWarnings(
  root: string,
  file: string,
  parent: ParentStyle,
  textStyle: StaticStyle,
  seen: Set<string>,
): NodeBudgetWarning[] {
  const lineBox = flutterTextLineBox(textStyle);
  for (const prop of ['height', 'minHeight']) {
    const raw = parent.style.get(prop);
    const contentHeight = raw == null ? null : contentHeightAfterPadding(raw, parent.style);
    if (contentHeight == null || contentHeight >= lineBox) continue;
    const warning = textWarning(
      root,
      file,
      `${parent.selector}:${prop}:content`,
      seen,
      (rel) =>
        `[fjs perf] ${rel} text in "${parent.selector}" gets about ` +
        `${fmtPx(contentHeight)} content height, below Flutter line box ~${lineBox}px. ` +
        `Increase height/padding balance or set an explicit smaller line-height.`,
    );
    return warning ? [warning] : [];
  }
  return [];
}

function textWarning(
  root: string,
  file: string,
  key: string,
  seen: Set<string>,
  text: (rel: string) => string,
): NodeBudgetWarning | null {
  const dedupeKey = `${file}:${key}`;
  if (seen.has(dedupeKey)) return null;
  seen.add(dedupeKey);
  return { file, nodes: 0, budget: 0, kind: 'text-layout', text: text(relativeFile(root, file)) };
}

function parseStyleRules(source: string): StyleRule[] {
  const rules: StyleRule[] = [];
  const css = stripComments(source);
  const block = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = block.exec(css))) {
    const declarations = parseCssDeclarations(match[2]);
    if (declarations.size === 0) continue;
    for (const rawSelector of splitTopLevel(match[1], ',')) {
      const selector = parseSimpleSelector(rawSelector.trim());
      if (selector) rules.push({ ...selector, declarations });
    }
  }
  return rules;
}

function parseSimpleSelector(selector: string): Omit<StyleRule, 'declarations'> | null {
  if (!selector || /[\s>+~#[\]:*]/.test(selector)) return null;
  const parts = selector.split('.');
  const tag = parts[0] ? parts[0] : null;
  const classes = parts.slice(tag ? 1 : 1).filter(Boolean);
  if (tag && !/^[A-Za-z][\w-]*$/.test(tag)) return null;
  if (!classes.every((item) => /^[A-Za-z_][\w-]*$/.test(item))) return null;
  if (!tag && classes.length === 0) return null;
  return { selector, tag, classes };
}

function parseCssDeclarations(source: string): StaticStyle {
  const out: StaticStyle = new Map();
  for (const part of splitTopLevel(source, ';')) {
    const colon = part.indexOf(':');
    if (colon <= 0) continue;
    const rawKey = part.slice(0, colon).trim();
    if (!rawKey || rawKey.startsWith('--')) continue;
    const rawValue = cleanStyleValue(part.slice(colon + 1));
    if (!rawValue) continue;
    out.set(styleKey(rawKey), rawValue);
  }
  return out;
}

function parseStyleObject(source: string, env: Env): StaticStyle {
  const out: StaticStyle = new Map();
  const fact = evalFact(source, env);
  if (fact?.kind === 'string') return parseCssDeclarations(fact.value);
  const trimmed = stripParens(source.trim());
  if (!trimmed.startsWith('{') || matchingEnd(trimmed, 0, '{', '}') !== trimmed.length - 1) {
    return out;
  }
  for (const part of splitTopLevel(trimmed.slice(1, -1), ',')) {
    const colon = part.indexOf(':');
    if (colon <= 0) continue;
    const rawKey = unquote(part.slice(0, colon).trim());
    const value = styleObjectValue(part.slice(colon + 1).trim(), env);
    if (rawKey && value != null) out.set(styleKey(rawKey), value);
  }
  return out;
}

function resolveStaticStyle(node: TemplateNode, env: Env, rules: StyleRule[]): StaticStyle {
  const out: StaticStyle = new Map();
  const classes = staticClasses(node, env);
  for (const rule of rules) {
    if (!matchesRule(node.tag ?? '', classes, rule)) continue;
    for (const [key, value] of rule.declarations) out.set(key, value);
  }
  for (const [key, value] of inlineStyle(node, env)) out.set(key, value);
  return out;
}

function matchesRule(tag: string, classes: string[], rule: StyleRule): boolean {
  if (rule.tag && rule.tag !== tag) return false;
  return rule.classes.every((item) => classes.includes(item));
}

function inlineStyle(node: TemplateNode, env: Env): StaticStyle {
  const out: StaticStyle = new Map();
  for (const prop of node.props ?? []) {
    if (prop.type === 6 && prop.name === 'style' && prop.value?.content) {
      for (const [key, value] of parseCssDeclarations(prop.value.content)) out.set(key, value);
    }
    if (
      prop.type === 7 &&
      prop.name === 'bind' &&
      prop.arg?.content === 'style' &&
      prop.exp?.content
    ) {
      for (const [key, value] of parseStyleObject(prop.exp.content, env)) out.set(key, value);
    }
  }
  return out;
}

function staticClasses(node: TemplateNode, env: Env): string[] {
  const classes: string[] = [];
  for (const prop of node.props ?? []) {
    if (prop.type === 6 && prop.name === 'class' && prop.value?.content) {
      classes.push(...prop.value.content.split(/\s+/).filter(Boolean));
    }
    if (
      prop.type === 7 &&
      prop.name === 'bind' &&
      prop.arg?.content === 'class' &&
      prop.exp?.content
    ) {
      const fact = evalFact(prop.exp.content, env);
      if (fact?.kind === 'string') classes.push(...fact.value.split(/\s+/).filter(Boolean));
    }
  }
  return [...new Set(classes)];
}

function nodeSelector(node: TemplateNode, env: Env): string {
  const classes = staticClasses(node, env);
  if (classes.length) return `.${classes.join('.')}`;
  return node.tag ? `<${node.tag}>` : '<node>';
}

function flutterTextLineBox(style: StaticStyle): number {
  const fontSize = styleLength(style.get('fontSize')) ?? 14;
  const explicitLineHeight = style.get('lineHeight');
  if (explicitLineHeight != null) {
    const absolute = pxLength(explicitLineHeight);
    if (absolute != null) return Math.ceil(absolute);
    const multiplier = finiteNumber(explicitLineHeight);
    if (multiplier != null) return Math.ceil(fontSize * multiplier);
  }
  return Math.max(20, Math.ceil(fontSize * 1.4));
}

function contentHeightAfterPadding(rawHeight: string, style: StaticStyle): number | null {
  const height = styleLength(rawHeight);
  const padding = verticalPadding(style);
  if (height == null || padding == null) return null;
  return Math.max(0, height - padding.top - padding.bottom);
}

function verticalPadding(style: StaticStyle): { top: number; bottom: number } | null {
  let top = 0;
  let bottom = 0;
  const padding = style.get('padding');
  if (padding != null) {
    const parsed = paddingShorthand(padding);
    if (!parsed) return null;
    top = parsed.top;
    bottom = parsed.bottom;
  }
  const block = style.get('paddingBlock');
  if (block != null) {
    const parsed = paddingPair(block);
    if (!parsed) return null;
    top = parsed.top;
    bottom = parsed.bottom;
  }
  const topRaw = style.get('paddingTop') ?? style.get('paddingBlockStart');
  const bottomRaw = style.get('paddingBottom') ?? style.get('paddingBlockEnd');
  if (topRaw != null) {
    const parsed = styleLength(topRaw);
    if (parsed == null) return null;
    top = parsed;
  }
  if (bottomRaw != null) {
    const parsed = styleLength(bottomRaw);
    if (parsed == null) return null;
    bottom = parsed;
  }
  return { top, bottom };
}

function paddingShorthand(source: string): { top: number; bottom: number } | null {
  const parts = source.trim().split(/\s+/).map(styleLength);
  if (parts.length === 0 || parts.some((item) => item == null)) return null;
  if (parts.length === 1) return { top: parts[0]!, bottom: parts[0]! };
  if (parts.length === 2) return { top: parts[0]!, bottom: parts[0]! };
  if (parts.length === 3) return { top: parts[0]!, bottom: parts[2]! };
  return { top: parts[0]!, bottom: parts[2]! };
}

function paddingPair(source: string): { top: number; bottom: number } | null {
  const parts = source.trim().split(/\s+/).map(styleLength);
  if (parts.length === 0 || parts.some((item) => item == null)) return null;
  return { top: parts[0]!, bottom: parts[1] ?? parts[0]! };
}

function styleLength(value: string | undefined): number | null {
  if (value == null) return null;
  const trimmed = value.trim();
  const px = /^(-?\d+(?:\.\d+)?)px$/.exec(trimmed);
  if (px) return Number(px[1]);
  return finiteNumber(trimmed);
}

function pxLength(value: string): number | null {
  const px = /^(-?\d+(?:\.\d+)?)px$/.exec(value.trim());
  return px ? Number(px[1]) : null;
}

function finiteNumber(value: string): number | null {
  const n = /^-?\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

function styleObjectValue(source: string, env: Env): string | null {
  const fact = evalFact(source, env);
  if (fact?.kind === 'string') return fact.value;
  if (fact?.kind === 'number') return String(fact.value);
  const raw = unquote(source.trim());
  return /^-?\d+(?:\.\d+)?(?:px)?$/.test(raw) ? raw : null;
}

function styleKey(key: string): string {
  return key.trim().replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

function cssName(key: string): string {
  return key.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
}

function unquote(source: string): string {
  const match = /^(?:'([^']*)'|"([^"]*)")$/.exec(source);
  return match ? match[1] ?? match[2] ?? '' : source;
}

function cleanStyleValue(source: string): string {
  return source.trim().replace(/\s*!important\s*$/, '').trim();
}

function fmtPx(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}px`;
}

function relativeFile(root: string, file: string): string {
  return path.relative(root, file).replace(/\\/g, '/');
}

function directive(node: TemplateNode, name: string): DirectiveNode | undefined {
  return node.props?.find(
    (prop): prop is DirectiveNode => prop.type === 7 && prop.name === name,
  );
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
    (prop): prop is DirectiveNode =>
      prop.type === 7 && prop.name === 'bind' && prop.arg?.content === 'is',
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
