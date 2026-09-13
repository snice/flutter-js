import { warn } from '../terminal/colors.js';
// Vue template AST -> WXML. This is the mp half of what compileTemplate does
// for the other two platforms: instead of a render function (which would drag
// the vdom runtime in), directives become wx:* attributes, bindings become
// {{}} interpolations, and everything the WXML expression language cannot
// evaluate (function calls, object :class/:style, inline event handlers)
// is extracted into generated setup code (the wevu-shaped runtime in
// @ufjs/runtime/wx supplies ref/computed and the setData diff).
//
// Event handlers all funnel through one method, `__fjsCall`: the template
// carries the target's name and any v-for scope values in data-* attributes
// (closures generated into the script can't see template scope), and the
// runtime adapts the raw wx event to fjs payload semantics (events.ts).
import {
  baseParse,
  type AttributeNode,
  type DirectiveNode,
  type ElementNode,
  type RootNode,
  type SimpleExpressionNode,
  type TemplateChildNode,
  type TextNode,
  type InterpolationNode,
  type ExpressionNode,
  NodeTypes,
} from '@vue/compiler-core';

// ---- tag mapping (spec 046 §4.3) -------------------------------------------

/** fjs tag -> wxml tag. Everything not listed passes through verbatim —
 * hello-fjs's tag set deliberately mirrors the wx built-ins. */
const TAG_REWRITE: Record<string, string> = {
  'inner-canvas': 'canvas',
  modal: 'fjs-modal', // custom component shipped by @ufjs/runtime/wx
  // runtime component: env(safe-area-inset-*) is unreliable in the DevTools
  // webview simulator, so the insets are measured at runtime (getWindowInfo)
  'safe-area': 'fjs-safe-area',
};

/** fjs tags that downgrade to a plain view carrying a builtin class — the
 * class gets its wxss appended to the component's stylesheet (see css.ts). */
const TAG_DOWNCAST: Record<string, { tag: string; cls: string }> = {
  stack: { tag: 'view', cls: 'fjs-stack' },
  divider: { tag: 'view', cls: 'fjs-divider' },
  position: { tag: 'view', cls: 'fjs-position' },
};

/** Attributes injected to keep skyline semantics right. */
const INJECTED_ATTRS: Record<string, Record<string, string>> = {
  // skyline's scroll-view only lays out as a list when typed; the attr is
  // accepted by the webview renderer too, so it's unconditional
  'scroll-view': { type: 'list' },
  canvas: { type: '2d' },
};

/** Event name fixes for native tags (@click is the fjs spelling of tap). */
const NATIVE_EVENT_ALIAS: Record<string, string> = {
  click: 'tap',
  'long-press': 'longpress',
};

/** tag-specific fjs -> wx event name remaps (checked before NATIVE_EVENT_ALIAS). */
const TAG_EVENT_ALIAS: Record<string, Record<string, string>> = {
  swiper: { 'page-changed': 'change' },
  input: { submit: 'confirm' },
  textarea: { submit: 'confirm' },
};

/** rewritten tags backed by runtime-provided component four-packs */
const RUNTIME_COMPONENT_TAGS = new Set(['fjs-modal', 'fjs-safe-area']);

/** Container tags carrying the layout baseline class. Skyline supports
 * CLASS selectors only — tag selectors (`view {}`) are ignored — so the
 * flex-column/border-box baseline rides on this class instead (see
 * APP_WXSS in project.ts). Must mirror APP_WXSS's old tag list. */
const CONTAINER_TAGS = new Set([
  'view', 'scroll-view', 'list-view', 'swiper-item', 'refresh', 'swiper',
  'form', 'label', 'radio', 'slider', 'checkbox', 'switch', 'progress',
  'picker-view', 'picker-view-column',
]);

const GLOBAL_IDENTIFIERS = new Set([
  'Math', 'JSON', 'console', 'Date', 'Number', 'String', 'Boolean', 'Array',
  'Object', 'undefined', 'null', 'true', 'false', 'Infinity', 'NaN',
  '$event', 'wx', 'getCurrentPages', 'encodeURIComponent', 'parseInt',
  'parseFloat', 'isNaN', 'Symbol', 'window', 'document',
]);

// ---- expression utilities ---------------------------------------------------

interface BindingInfo {
  bindings: Record<string, string>;
  /** identifiers never touched: v-for vars, handler params, generated names */
  skip: Set<string>;
}

function isIdentStart(ch: string): boolean {
  return /[A-Za-z_$]/.test(ch);
}

function prevMeaningful(expr: string, index: number): string {
  for (let i = index - 1; i >= 0; i--) {
    if (!/\s/.test(expr[i])) return expr[i];
  }
  return '';
}

function nextMeaningful(expr: string, index: number): string {
  for (let i = index; i < expr.length; i++) {
    if (!/\s/.test(expr[i])) return expr[i];
  }
  return '';
}

/** Walks the identifiers of `expr` (skipping string literals, object literal
 * keys, property accesses), feeding each to `visit` and joining results. */
function mapIdentifiers(
  expr: string,
  visit: (ident: string, isObjectKey: boolean, isProperty: boolean) => string,
): string {
  let out = '';
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      let j = i + 1;
      while (j < expr.length && expr[j] !== quote) {
        if (expr[j] === '\\') j++;
        j++;
      }
      out += expr.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (isIdentStart(ch)) {
      let j = i + 1;
      while (j < expr.length && /[A-Za-z0-9_$]/.test(expr[j])) j++;
      const ident = expr.slice(i, j);
      const isProperty = prevMeaningful(expr, i) === '.';
      const next = nextMeaningful(expr, j);
      const isObjectKey = (prevMeaningful(expr, i) === '{' || prevMeaningful(expr, i) === ',') && next === ':';
      out += visit(ident, isObjectKey, isProperty);
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Free identifiers that are NOT setup bindings and NOT globals — on a
 * template, that means v-for/slot scope vars. These must ride to a handler
 * through data-args. */
export function freeScopeIdentifiers(
  expr: string,
  bindings: Record<string, string>,
  skip: Set<string>,
): string[] {
  const found: string[] = [];
  mapIdentifiers(expr, (ident, isObjectKey, isProperty) => {
    if (
      !isObjectKey &&
      !isProperty &&
      !skip.has(ident) &&
      !GLOBAL_IDENTIFIERS.has(ident) &&
      !(ident in bindings) &&
      !found.includes(ident)
    ) {
      found.push(ident);
    }
    return '';
  });
  return found;
}

/** Appends `.value` to setup refs (binding type `setup-ref`) so generated
 * code can read AND assign them. Mirrors what compileTemplate's
 * transformExpression does for render functions. */
export function rewriteExpr(expr: string, info: BindingInfo): string {
  return mapIdentifiers(expr, (ident, isObjectKey, isProperty) => {
    if (isObjectKey || isProperty || info.skip.has(ident)) return ident;
    if (info.bindings[ident] === 'setup-ref') return ident + '.value';
    return ident;
  });
}

/** Setup bindings referenced anywhere in an expression — the candidates for
 * the snapshot data the wxml expressions read. */
export function referencedBindings(expr: string, bindings: Record<string, string>): string[] {
  const found: string[] = [];
  mapIdentifiers(expr, (ident, isObjectKey, isProperty) => {
    if (!isObjectKey && !isProperty && ident in bindings && !found.includes(ident)) {
      found.push(ident);
    }
    return '';
  });
  return found;
}

// ---- codegen ----------------------------------------------------------------

export interface WxmlOptions {
  /** bindingMetadata from compileScript ('setup-ref' etc.). */
  bindings: Record<string, string>;
  /** scope id stamped as a class on every element (skyline doesn't match
   * attribute selectors, so the scoped-styles trick needs a class). */
  scopeId?: string;
  /** Local SFC imports: setup binding name -> source file. An element tag
   * matching a name here compiles as a custom component. */
  vueImports: Map<string, string>;
  /** Widget tags declared by fjs modules (`fjs.widgets.*.mp`) — custom
   * components the mp build copies from the module package. */
  moduleTags?: Set<string>;
  /** Local component tags removed from the mp emission entirely (the app's
   * custom tab bar when the native tabBar takes over). Usages in templates
   * are dropped; the SFC is never compiled. */
  stripTags?: Set<string>;
  /** Class names of THIS SFC whose rules set `height` — lets the scroll-view
   * check accept class-based heights (`.page { height: 100vh }`). */
  heightClasses?: Set<string>;
  filename: string;
}

export interface WxmlResult {
  wxml: string;
  /** `const __ev0 = ...` lines to inject into setup(). */
  setupCode: string[];
  /** Names to add to script-setup's __returned__ (handlers + computeds). */
  returnedNames: string[];
  /** Setup bindings referenced from template expressions — the runtime
   * narrows setData to exactly these keys. */
  dataNames: string[];
  /** usingComponents entries: kebab tag -> absolute source path of the
   * local SFC, or a runtime component name. */
  usingComponents: Map<string, string>;
  /** builtin classes used by downcast tags (css.ts appends their styles). */
  fjsClasses: string[];
}

interface Ctx extends WxmlOptions, WxmlResult {
  counters: { ev: number; cls: number; sty: number; d: number };
}

interface Scope {
  forVars: Set<string>;
}

const INDENT = '  ';
const pad = (depth: number) => INDENT.repeat(depth);

export function genWxml(template: string, options: WxmlOptions): WxmlResult {
  const tree: RootNode = baseParse(template);
  const ctx: Ctx = {
    ...options,
    wxml: '',
    setupCode: [],
    returnedNames: [],
    dataNames: [],
    usingComponents: new Map(),
    fjsClasses: [],
    counters: { ev: 0, cls: 0, sty: 0, d: 0 },
  };
  ctx.wxml = genChildren(tree.children, ctx, { forVars: new Set() }, 0);
  return {
    wxml: ctx.wxml,
    setupCode: ctx.setupCode,
    returnedNames: ctx.returnedNames,
    dataNames: ctx.dataNames,
    usingComponents: ctx.usingComponents,
    fjsClasses: ctx.fjsClasses,
  };
}

function trackData(ctx: Ctx, expr: string): void {
  for (const name of referencedBindings(expr, ctx.bindings)) {
    if (!ctx.dataNames.includes(name)) ctx.dataNames.push(name);
  }
}

function genChildren(nodes: TemplateChildNode[], ctx: Ctx, scope: Scope, depth: number, parentTag?: string): string {
  let out = '';
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.type === NodeTypes.COMMENT) continue;
    // WXML preserves whitespace: emitting each text/interpolation child on
    // its own indented line renders REAL line breaks inside <text>. Runs of
    // adjacent text/interpolation therefore join onto one line, whitespace
    // condensed (Vue's own condense semantics).
    if (node.type === NodeTypes.TEXT || node.type === NodeTypes.INTERPOLATION) {
      const run: Array<{ text?: string; expr?: string }> = [];
      for (let j = i; j < nodes.length; j++) {
        const n = nodes[j];
        if (n.type === NodeTypes.TEXT) run.push({ text: (n as TextNode).content });
        else if (n.type === NodeTypes.INTERPOLATION)
          run.push({ expr: inlineExpr(exprContent((n as InterpolationNode).content), ctx, scope) });
        else break;
      }
      i += run.length - 1;
      // condense whitespace: trim the run's ends, collapse inner runs; the
      // single spaces BETWEEN parts are meaningful (Wi-Fi {{ x }}，推送)
      if (run[0]?.text !== undefined) run[0].text = run[0].text.replace(/^\s+/, '');
      const last = run[run.length - 1];
      if (last?.text !== undefined) last.text = last.text.replace(/\s+$/, '');
      const emitted = run.filter((p) => (p.text !== undefined ? p.text !== '' : true));
      if (!emitted.length) continue;
      let out2: string;
      if (emitted.length === 1) {
        const only = emitted[0];
        out2 = only.text !== undefined ? escapeText(only.text) : `{{ ${only.expr} }}`;
      } else {
        // one concatenation expression: 'text' + (expr) + 'text'
        const terms = emitted
          .map((p) => {
            if (p.expr !== undefined) return `(${p.expr})`;
            const t = p.text!.replace(/\s+/g, ' ');
            const quote = t.includes("'") ? '"' : "'";
            return t.includes(quote) ? t : `${quote}${t}${quote}`;
          })
          .join(' + ');
        out2 = `{{ ${terms} }}`;
      }
      if (out2) out += pad(depth) + out2 + '\n';
      continue;
    }
    const ifDir = findDir(node, 'if');
    if (ifDir) {
      out += genNode(node, ctx, scope, depth, { ifAttr: ifAttrOf(ifDir.exp, ctx, scope, 'wx:if'), parentTag });
      let j = i + 1;
      while (j < nodes.length) {
        const sib = nodes[j];
        const elif = findDir(sib, 'else-if');
        const els = findDir(sib, 'else');
        if (elif) {
          out += genNode(sib, ctx, scope, depth, {
            ifAttr: ifAttrOf(elif.exp, ctx, scope, 'wx:elif'),
            parentTag,
          });
        } else if (els) {
          out += genNode(sib, ctx, scope, depth, { ifAttr: ' wx:else', parentTag });
        } else break;
        j++;
      }
      i = j - 1;
      continue;
    }
    if (findDir(node, 'else-if') || findDir(node, 'else')) {
      continue; // orphaned branch — the chain above consumed it
    }
    out += genNode(node, ctx, scope, depth, { parentTag });
  }
  return out;
}

function ifAttrOf(
  exp: ExpressionNode | undefined,
  ctx: Ctx,
  scope: Scope,
  name: 'wx:if' | 'wx:elif',
): string {
  const expr = exprContent(exp);
  trackData(ctx, expr);
  return ` ${name}="{{ ${inlineExpr(expr, ctx, scope)} }}"`;
}

interface GenOpts {
  /** pre-built wx:if/elif/else attribute (from the chain walk) */
  ifAttr?: string;
  /** called from genFor: don't re-emit this element's v-for / v-if */
  skipFor?: boolean;
  /** the containing element's tag, for context-sensitive emission */
  parentTag?: string;
}

function genNode(node: TemplateChildNode, ctx: Ctx, scope: Scope, depth: number, opts: GenOpts = {}): string {
  if (node.type === NodeTypes.TEXT) {
    return pad(depth) + escapeText((node as TextNode).content) + '\n';
  }
  if (node.type === NodeTypes.INTERPOLATION) {
    const expr = exprContent((node as InterpolationNode).content);
    return pad(depth) + `{{ ${inlineExpr(expr, ctx, scope)} }}\n`;
  }
  if (node.type !== NodeTypes.ELEMENT) return '';
  const el = node as ElementNode;

  const forDir = opts.skipFor ? undefined : findDir(el, 'for');
  if (forDir) {
    return genFor(el, forDir, ctx, scope, depth, opts);
  }

  const isBlock = el.tag === 'template';
  const resolved = isBlock ? { tag: 'block', custom: false } : resolveTag(el, ctx);
  if (resolved.strip) {
    // dropped wholesale (native tabBar replaces the app's custom one);
    // a stripped node inside an if/else chain would orphan the wx:else
    if (findDir(el, 'if') || findDir(el, 'else') || findDir(el, 'else-if')) {
      warn(
        `[fjs/mp] ${ctx.filename}: stripped component <${el.tag}> takes part in an if/else chain — the chain needs manual adjustment`,
      );
    }
    return '';
  }
  const tag = resolved.tag;
  const custom = resolved.custom;
  const attrs = genAttrs(el, ctx, scope, custom, tag, resolved.downcastCls);

  let ifAttr = opts.ifAttr ?? '';
  if (!ifAttr && !opts.skipFor) {
    const own = findDir(el, 'if');
    if (own) ifAttr = ifAttrOf(own.exp, ctx, scope, 'wx:if');
  }

  if (!isBlock && el.tag === 'slot') {
    const nameAttr = staticAttr(el, 'name');
    const outlet = `<slot${nameAttr ? ` name="${nameAttr}"` : ''} />`;
    // skyline's scroll-view type=list requires element children — a bare
    // slot (a fragment) crashes attachView with "appendChild expects a
    // valid Node", so it gets a content wrapper
    if (opts.parentTag === 'scroll-view') {
      if (!ctx.fjsClasses.includes('fjs-scroll-inner')) ctx.fjsClasses.push('fjs-scroll-inner');
      return `${pad(depth)}<view class="fjs-scroll-inner">\n${pad(depth)}  ${outlet}\n${pad(depth)}</view>\n`;
    }
    return pad(depth) + outlet + '\n';
  }

  const showDir = findDir(el, 'show');
  if (showDir) {
    const expr = exprContent(showDir.exp);
    trackData(ctx, expr);
    attrs.push(`hidden="{{ !(${inlineExpr(expr, ctx, scope)}) }}"`);
  }

  const open = `<${tag}${ifAttr}${attrs.length ? ' ' + attrs.join(' ') : ''}>`;

  if (isBlock) {
    // a <template> is transparent: its children keep the block's own parent
    const inner = genChildren(el.children, ctx, scope, depth + 1, opts.parentTag);
    return `${pad(depth)}${open}\n${inner}${pad(depth)}</block>\n`;
  }

  const children = genSlotContent(el, ctx, scope, depth + 1, custom, tag);
  if (!children) return `${pad(depth)}${open.replace(/>$/, ' />')}\n`;
  return `${pad(depth)}${open}\n${children}${pad(depth)}</${tag}>\n`;
}

/** Children of an element: default slot content verbatim; <template
 * v-slot:x> branches get slot="x" stamped onto each child element. */
function genSlotContent(el: ElementNode, ctx: Ctx, scope: Scope, depth: number, custom: boolean, parentTag?: string): string {
  if (el.children.length === 0) return '';
  const slotTemplates = el.children.filter(
    (c): c is ElementNode =>
      c.type === NodeTypes.ELEMENT && (c as ElementNode).tag === 'template' && !!findDir(c, 'slot'),
  );
  if (slotTemplates.length === 0) {
    // no named slots: ordinary children, v-if chains included
    return genChildren(el.children, ctx, scope, depth, parentTag);
  }
  void custom;
  let out = '';
  for (const child of el.children) {
    if (child.type === NodeTypes.ELEMENT && (child as ElementNode).tag === 'template' && findDir(child, 'slot')) {
      const slotDir = findDir(child, 'slot')!;
      const slotName = slotDir.arg?.type === NodeTypes.SIMPLE_EXPRESSION ? slotDir.arg.content : '';
      if (slotDir.exp) {
        warn(
          `[fjs/mp] ${ctx.filename}: scoped slots are not supported (slot "${slotName}")`,
        );
      }
      for (const sub of (child as ElementNode).children) {
        out += withSlotAttr(sub, slotName, ctx, scope, depth);
      }
      continue;
    }
    out += genNode(child, ctx, scope, depth);
  }
  return out;
}

function withSlotAttr(node: TemplateChildNode, slotName: string, ctx: Ctx, scope: Scope, depth: number): string {
  const rendered = genNode(node, ctx, scope, depth);
  if (!slotName || node.type !== NodeTypes.ELEMENT) return rendered;
  return rendered.replace(/^(\s*<[A-Za-z][^\s/>]*)/, `$1 slot="${slotName}"`);
}

function genFor(
  el: ElementNode,
  forDir: DirectiveNode,
  ctx: Ctx,
  scope: Scope,
  depth: number,
  opts: GenOpts = {},
): string {
  const exp = exprContent(forDir.exp).trim();
  const m = /^\(?([^()]*?)\)?\s+(?:in|of)\s+([\s\S]+)$/.exec(exp);
  if (!m) {
    warn(`[fjs/mp] ${ctx.filename}: cannot parse v-for "${exp}"`);
    return '';
  }
  const vars = m[1].split(',').map((s) => s.trim()).filter(Boolean);
  if (vars.some((v) => /[^A-Za-z0-9_$]/.test(v))) {
    warn(`[fjs/mp] ${ctx.filename}: destructuring in v-for is not supported: "${exp}"`);
  }
  const itemVar = vars[0] ?? 'item';
  const indexVar = vars[1] ?? 'index';
  const listExpr = m[2].trim();
  trackData(ctx, listExpr);

  const innerScope: Scope = { forVars: new Set([...scope.forVars, itemVar, indexVar]) };

  // v-if beside v-for: Vue 3 evaluates v-if first (it can't see the item),
  // so placing it on the block matches that semantics
  const ifDir = findDir(el, 'if');

  const keyAttr = el.props.find(
    (p): p is DirectiveNode =>
      p.type === NodeTypes.DIRECTIVE && p.name === 'bind' && dirArg(p) === 'key',
  );
  let wxKey = '';
  if (keyAttr?.exp) {
    const k = exprContent(keyAttr.exp).trim();
    const prop = new RegExp(`^${itemVar}\\.(\\w+)$`).exec(k);
    if (prop) wxKey = prop[1];
    else if (k === itemVar) wxKey = '*this';
    else {
      warn(
        `[fjs/mp] ${ctx.filename}: :key="${k}" is not an item property — wx:key omitted`,
      );
    }
  }

  const inner = el.tag === 'template'
    ? genChildren(el.children, ctx, innerScope, depth + 1)
    : genNode(el, ctx, innerScope, depth + 1, { skipFor: true }).trimEnd();

  const attrs = [
    `wx:for="{{ ${inlineExpr(listExpr, ctx, innerScope)} }}"`,
    `wx:for-item="${itemVar}"`,
    `wx:for-index="${indexVar}"`,
    wxKey ? `wx:key="${wxKey}"` : '',
    ifDir ? ifAttrOf(ifDir.exp, ctx, innerScope, 'wx:if') : opts.ifAttr ?? '',
  ].filter(Boolean);
  return `${pad(depth)}<block ${attrs.join(' ')}>\n${inner}\n${pad(depth)}</block>\n`;
}

function resolveTag(el: ElementNode, ctx: Ctx): { tag: string; custom: boolean; strip?: boolean; downcastCls?: string } {
  const tag = el.tag;
  if (ctx.vueImports.has(tag)) {
    const kebab = toKebab(tag);
    if (ctx.stripTags?.has(kebab)) return { tag: kebab, custom: true, strip: true };
    ctx.usingComponents.set(kebab, ctx.vueImports.get(tag)!);
    return { tag: kebab, custom: true };
  }
  if (ctx.moduleTags?.has(tag)) {
    ctx.usingComponents.set(tag, `module:${tag}`);
    return { tag, custom: true };
  }
  if (TAG_REWRITE[tag]) {
    const mapped = TAG_REWRITE[tag];
    if (RUNTIME_COMPONENT_TAGS.has(mapped)) ctx.usingComponents.set(mapped, mapped);
    return { tag: mapped, custom: RUNTIME_COMPONENT_TAGS.has(mapped) };
  }
  if (TAG_DOWNCAST[tag]) {
    const d = TAG_DOWNCAST[tag];
    if (!ctx.fjsClasses.includes(d.cls)) ctx.fjsClasses.push(d.cls);
    // the class must GO ON THE ELEMENT, not just into the stylesheet
    return { tag: d.tag, custom: false, downcastCls: d.cls };
  }
  return { tag, custom: false };
}

interface EventBinding {
  /** full attribute name — bindtap / bind:modal-closed */
  native: string;
  /** wx event type (e.type) the adapter dispatches on */
  type: string;
  /** setup binding to call */
  handler: string;
  scopeVars: string[];
}

function genAttrs(el: ElementNode, ctx: Ctx, scope: Scope, custom: boolean, mappedTag: string, downcastCls?: string): string[] {
  const attrs: string[] = [];
  const events: EventBinding[] = [];

  // class is assembled from up to four sources: the downcast builtin class
  // (safe-area -> .fjs-safe-area), the static class, the :class binding and
  // the scope id. Assembled once, at the end, in that order.
  const clsParts: string[] = [];
  if (downcastCls) clsParts.push(downcastCls);
  let dynamicClass: DirectiveNode | undefined;

  for (const prop of el.props) {
    if (prop.type === NodeTypes.ATTRIBUTE) {
      const a = prop as AttributeNode;
      if (a.name === 'key' || a.name === 'class') continue; // assembled below / with v-for
      const name = kebabAttr(a.name);
      const value = a.value?.content;
      if (value === undefined || value === null || value === '') {
        // bare attribute: native Boolean props treat "" as false, so emit an
        // explicit true (custom components get the bare name back)
        attrs.push(custom ? name : `${name}="{{ true }}"`);
      } else {
        attrs.push(`${name}="${escapeAttr(value)}"`);
      }
      continue;
    }
    if (prop.type !== NodeTypes.DIRECTIVE) continue;
    const d = prop as DirectiveNode;
    switch (d.name) {
      case 'if':
      case 'else-if':
      case 'else':
      case 'for':
      case 'slot':
      case 'show':
        continue; // handled by the chain/for/slot/genNode logic
      case 'bind': {
        const arg = dirArg(d);
        if (!arg) {
          warn(`[fjs/mp] ${ctx.filename}: v-bind without an argument is not supported`);
          continue;
        }
        if (arg === 'key') continue;
        if (arg === 'class') {
          dynamicClass = d;
          continue;
        }
        if (arg === 'style') {
          attrs.push(genStyleBinding(el, d, ctx, scope));
          continue;
        }
        const expr = exprContent(d.exp);
        trackData(ctx, expr);
        attrs.push(`${kebabAttr(arg)}="{{ ${inlineExpr(expr, ctx, scope)} }}"`);
        continue;
      }
      case 'on': {
        const ev = dirArg(d) ?? '';
        const binding = genEvent(d, ev, ctx, scope, custom, el.tag, mappedTag);
        if (binding) events.push(binding);
        continue;
      }
      case 'model': {
        const binding = genModel(d, el, ctx, scope, attrs);
        if (binding) events.push(binding);
        continue;
      }
      case 'html':
      case 'text':
      case 'pre':
      case 'cloak':
      case 'scope':
      case 'slot-scope':
        warn(`[fjs/mp] ${ctx.filename}: v-${d.name} is not supported and was dropped`);
        continue;
      default:
        warn(`[fjs/mp] ${ctx.filename}: unsupported directive v-${d.name}`);
    }
  }

  // class value = chunks: literal text inlined, expressions as {{ }}
  // (never nested braces — wxml's expression scanner dies on them)
  const clsValue: Array<{ text?: string; expr?: string }> = [];
  if (CONTAINER_TAGS.has(mappedTag)) clsValue.push({ text: 'fjs-box' });
  if (downcastCls) clsValue.push({ text: downcastCls });
  const staticCls = staticAttr(el, 'class');
  if (staticCls) clsValue.push({ text: staticCls });
  if (dynamicClass) clsValue.push(...classValueChunks(el, dynamicClass, ctx, scope));
  if (ctx.scopeId) clsValue.push({ text: ctx.scopeId });
  if (clsValue.length) {
    const value = clsValue
      .map((c) => (c.text !== undefined ? escapeAttr(c.text) : `{{ ${c.expr} }}`))
      .join(' ');
    attrs.unshift(`class="${value}"`);
  }

  // event funnel: every binding lands on the runtime's __fjsCall, which
  // reads data-fn (handler) and dispatches the payload by e.type. A
  // multi-event element shares ONE dataset — data-fn would collapse to the
  // last handler — so its handlers go behind a type dispatcher instead.
  if (events.length === 1) {
    const e = events[0];
    attrs.push(`${e.native}="__fjsCall"`, `data-fn="${e.handler}"`);
    if (e.scopeVars.length) attrs.push(`data-args="{{ [${e.scopeVars.join(', ')}] }}"`);
  } else if (events.length > 1) {
    const dispatcher = `__ev${ctx.counters.ev++}`;
    const branches = events
      .map((e) => `if (__t === ${JSON.stringify(e.type)}) ${e.handler}(__e, ...__s);`)
      .join(' else ');
    ctx.setupCode.push(`const ${dispatcher} = (__e, ...__s) => { const __t = __e && __e.type; ${branches} };`);
    ctx.returnedNames.push(dispatcher);
    for (const e of events) attrs.push(`${e.native}="__fjsCall"`);
    attrs.push(`data-fn="${dispatcher}"`);
    const scopeVars = [...new Set(events.flatMap((e) => e.scopeVars))];
    if (scopeVars.length) attrs.push(`data-args="{{ [${scopeVars.join(', ')}] }}"`);
  }
  if (events.length) attrs.push(`data-tag="${sourceTagOf(el, mappedTag)}"`);
  for (const [k, v] of Object.entries(INJECTED_ATTRS[mappedTag] ?? {})) {
    if (!attrs.some((a) => a.startsWith(k + '='))) attrs.push(`${k}="${v}"`);
  }
  // WebView scroll-view does not scroll without an explicit direction
  // (skyline recommends it too); horizontal scrollers opt out via scroll-x
  if (mappedTag === 'scroll-view' && !attrs.some((a) => a.startsWith('scroll-y=')) && !attrs.some((a) => a.startsWith('scroll-x='))) {
    attrs.push('scroll-y="{{ true }}"');
  }
  // skyline renders a scroll-view with no definite height as NOTHING (webview
  // flex-grow chains hide the difference). Enforced at compile time so the
  // failure is loud: explicit height must be visible in style/:style, or in
  // one of the element's classes (this SFC's rules).
  if (mappedTag === 'scroll-view' && scrollviewHeightMissing(el, ctx)) {
    const at = el.loc ? ` at template ${el.loc.start.line}:${el.loc.start.column}` : '';
    throw new Error(
      `[fjs/mp] ${ctx.filename}${at}: <scroll-view> has no explicit height — ` +
        'skyline renders it with zero height. Add one, e.g. ' +
        'style="height: 100vh", .cls { height: 100vh }, or height: 0px + flex-grow.',
    );
  }
  return attrs;
}

/** True when no height is statically visible on this scroll-view. */
function scrollviewHeightMissing(el: ElementNode, ctx: Ctx): boolean {
  const style = staticAttr(el, 'style') ?? '';
  if (/(^|;)\s*height\s*:/.test(style)) return false;
  const styleDir = el.props.find(
    (p): p is DirectiveNode => p.type === NodeTypes.DIRECTIVE && p.name === 'bind' && dirArg(p) === 'style',
  );
  if (styleDir?.exp && /(^|;|\{)\s*height\s*:/.test(exprContent(styleDir.exp))) return false;
  const classes = (staticAttr(el, 'class') ?? '').split(/\s+/).filter(Boolean);
  for (const c of classes) {
    if (ctx.heightClasses?.has(c)) return false;
  }
  return true;
}

/** :class value chunks: literal text inlined into the attribute, expression
 * segments emitted as separate {{ }} — object/array literals expand INLINE
 * so the entry values keep their wxml scope (v-for item/index), which an
 * instance-level computed could never see. Other shapes fall back to a
 * computed (which then cannot reference for-scope vars — warned below). */
type ClassChunk = { text?: string; expr?: string };

function classValueChunks(el: ElementNode, d: DirectiveNode, ctx: Ctx, scope: Scope): ClassChunk[] {
  const expr = exprContent(d.exp).trim();
  if (expr.startsWith('{')) {
    return [{ expr: inlineClassObject(expr, ctx, scope) }];
  }
  if (expr.startsWith('[')) {
    const chunks: ClassChunk[] = [];
    let ok = true;
    for (const part of splitTopLevel(expr.slice(1, -1))) {
      const e = part.trim();
      if (/^['"]/.test(e)) chunks.push({ text: e.slice(1, -1) });
      else if (e.startsWith('{')) chunks.push({ expr: inlineClassObject(e, ctx, scope) });
      else {
        trackData(ctx, e);
        chunks.push({ expr: e });
      }
    }
    if (ok && chunks.length) return chunks;
  } else if (expr.startsWith('`')) {
    return [{ expr: templateLiteralToConcat(expr) }];
  }
  // computed fallback: no per-item evaluation, so for-scope vars break
  const free = freeScopeIdentifiers(expr, ctx.bindings, new Set(GLOBAL_IDENTIFIERS));
  if (free.some((v) => scope.forVars.has(v))) {
    warn(
      `[fjs/mp] ${ctx.filename}: :class="${expr}" uses v-for scope vars but fell back to a computed — unsupported`,
    );
  }
  const name = `__cls${ctx.counters.cls++}`;
  ctx.setupCode.push(computedSrc(name, `__fjsStringifyClass(${rewritten(expr, ctx, scope)})`));
  ctx.returnedNames.push(name);
  trackData(ctx, expr);
  return [{ expr: name }];
}

/** Object-literal :class entries expanded to a concatenation of conditional
 * class names (values keep their wxml scope). */
function inlineClassObject(expr: string, ctx: Ctx, scope: Scope): string {
  const parts = splitTopLevel(expr.slice(1, -1));
  const out = parts
    .map((part) => {
      const i = findKeyColon(part);
      if (i < 0) return null;
      const key = part.slice(0, i).trim().replace(/^['"]|['"]$/g, '');
      const value = part.slice(i + 1).trim();
      if (!key || !value) return null;
      trackData(ctx, value);
      return `(${value} ? '${key} ' : '')`;
    })
    .filter((v): v is string => v !== null);
  if (out.length !== parts.length) {
    warn(`[fjs/mp] ${ctx.filename}: unsupported :class object entries — dropped: "${expr}"`);
  }
  return out.join(' + ') || "''";
}

function genStyleBinding(el: ElementNode, d: DirectiveNode, ctx: Ctx, scope: Scope): string {
  const expr = exprContent(d.exp).trim();
  const inline = inlineStyleExpr(expr, ctx, scope);
  const staticSty = staticAttr(el, 'style');
  return `style="${staticSty ? escapeAttr(staticSty) + '; ' : ''}{{ ${inline} }}"`;
}

function inlineStyleExpr(expr: string, ctx: Ctx, scope: Scope): string {
  if (expr.startsWith('{')) {
    const parts = splitTopLevel(expr.slice(1, -1));
    const out = parts
      .map((part) => {
        const i = findKeyColon(part);
        if (i < 0) return null;
        const key = toKebab(part.slice(0, i).trim().replace(/^['"]|['"]$/g, ''));
        const value = part.slice(i + 1).trim();
        if (!key || !value) return null;
        trackData(ctx, value);
        // quoted literal values inline directly; numbers pass through as-is
        return `'${key}:' + (${value}) + ';'`;
      })
      .filter((v): v is string => v !== null);
    if (out.length !== parts.length) {
      warn(`[fjs/mp] ${ctx.filename}: unsupported :style object entries — dropped: "${expr}"`);
    }
    if (out.length) return out.join(' + ');
  } else if (expr.startsWith('`')) {
    return templateLiteralToConcat(expr);
  }
  const free = freeScopeIdentifiers(expr, ctx.bindings, new Set(GLOBAL_IDENTIFIERS));
  if (free.some((v) => scope.forVars.has(v))) {
    warn(
      `[fjs/mp] ${ctx.filename}: :style="${expr}" uses v-for scope vars but fell back to a computed — unsupported`,
    );
  }
  const name = `__sty${ctx.counters.sty++}`;
  ctx.setupCode.push(computedSrc(name, `__fjsStringifyStyle(${rewritten(expr, ctx, scope)})`));
  ctx.returnedNames.push(name);
  trackData(ctx, expr);
  return name;
}

/** Compiles an inline handler into a generated function. The generated
 * signature is `(__e, ...__s)`: __e is the adapted fjs payload, __s the
 * data-args (v-for scope vars). User arrow params receive the payload
 * first, matching fjs's "@change gives you the value" semantics. */
function genInlineHandler(
  handler: string,
  ctx: Ctx,
  scope: Scope,
  name: string,
): { code: string; scopeVars: string[] } {
  const arrow = /^\s*(\(([^)]*)\)\s*=>|[A-Za-z_$][A-Za-z0-9_$]*\s*=>)/.exec(handler);
  if (arrow) {
    const headEnd = arrow[0].length;
    const rawParams = arrow[2] !== undefined ? arrow[2] : arrow[1].replace(/\s*=>\s*$/, '');
    const userParams = rawParams.split(',').map((s) => s.trim()).filter(Boolean);
    const userNames = userParams
      .map((p) => /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(p)?.[0] ?? '')
      .filter(Boolean);
    const body = handler.slice(headEnd).trim();
    // NOTE: scope.forVars are deliberately NOT in this skip set — a free
    // for-var inside a generated closure must ride through data-args
    // (closures can't see wxml scope)
    const skip = new Set([...userNames, '__e', '__s']);
    const scopeVars = freeScopeIdentifiers(body, ctx.bindings, skip);
    const rewritten = rewriteExpr(body.replace(/\$event/g, '__e'), {
      bindings: ctx.bindings,
      skip: new Set([...scope.forVars, ...userNames, ...scopeVars, '__e', '__s']),
    });
    if (userParams.length === 0 && scopeVars.length === 0) {
      return { code: `const ${name} = (__e) => ${rewritten};`, scopeVars };
    }
    const innerParams = [...userParams, ...scopeVars].join(', ');
    const callArgs = [...(userParams.length ? ['__e'] : []), '...__s'].join(', ');
    return {
      code: `const ${name} = (__e, ...__s) => ((${innerParams}) => ${rewritten})(${callArgs});`,
      scopeVars,
    };
  }
  // statement(s): bind scope vars via destructured data-args
  const skip = new Set(['__e', '__s']);
  const scopeVars = freeScopeIdentifiers(handler, ctx.bindings, skip);
  const rewritten = rewriteExpr(handler.replace(/\$event/g, '__e'), {
    bindings: ctx.bindings,
    skip: new Set([...scope.forVars, ...scopeVars, '__e', '__s']),
  });
  const bind = scopeVars.length ? `const [${scopeVars.join(', ')}] = __s; ` : '';
  return { code: `const ${name} = (__e, ...__s) => { ${bind}${rewritten}; };`, scopeVars };
}

function genEvent(
  d: DirectiveNode,
  event: string,
  ctx: Ctx,
  scope: Scope,
  custom: boolean,
  sourceTag: string,
  mappedTag: string,
): EventBinding | null {
  if (!d.exp) {
    warn(`[fjs/mp] ${ctx.filename}: @${event} without a handler was dropped`);
    return null;
  }
  const handler = exprContent(d.exp).trim();
  const isCustom = custom || mappedTag === 'fjs-modal';
  const nativeName = isCustom
    ? event
    : TAG_EVENT_ALIAS[sourceTag]?.[event] ??
      NATIVE_EVENT_ALIAS[event] ??
      event.toLowerCase().replace(/-/g, '');
  const native = isCustom ? 'bind:' + nativeName : 'bind' + nativeName;

  // plain identifier: reference the setup function directly by name
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(handler)) {
    if (!(handler in ctx.bindings)) {
      warn(`[fjs/mp] ${ctx.filename}: handler "${handler}" is not a setup binding`);
    }
    return { native, type: nativeName, handler, scopeVars: [] };
  }

  // inline expression -> generated handler (see genInlineHandler)
  const name = `__ev${ctx.counters.ev++}`;
  const { code, scopeVars } = genInlineHandler(handler, ctx, scope, name);
  ctx.setupCode.push(code);
  ctx.returnedNames.push(name);
  return { native, type: nativeName, handler: name, scopeVars };
}

function genModel(d: DirectiveNode, el: ElementNode, ctx: Ctx, scope: Scope, attrs: string[]): EventBinding | null {
  const expr = exprContent(d.exp);
  const tag = el.tag;
  if (tag !== 'input' && tag !== 'textarea') {
    warn(
      `[fjs/mp] ${ctx.filename}: v-model on <${tag}> is not supported — use :value + @change`,
    );
    return null;
  }
  const name = `__ev${ctx.counters.ev++}`;
  ctx.setupCode.push(
    `const ${name} = (__e) => { ${rewriteExpr(expr, { bindings: ctx.bindings, skip: scope.forVars })} = __e; };`,
  );
  ctx.returnedNames.push(name);
  trackData(ctx, expr);
  attrs.push(`value="{{ ${inlineExpr(expr, ctx, scope)} }}"`);
  return { native: 'bindinput', type: 'input', handler: name, scopeVars: [] };
}

// ---- small helpers ----------------------------------------------------------

/** The tag the runtime event adapter keys on: the MAPPED tag (inner-canvas
 * adapts as canvas), not the fjs spelling. */
function sourceTagOf(el: ElementNode, mappedTag: string): string {
  return mappedTag;
}


/** Splits on commas that sit at brace/bracket/paren depth zero and outside
 * string literals. */
function splitTopLevel(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i++;
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\') i++;
        i++;
      }
    } else if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === ',' && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
    i++;
  }
  if (text.slice(start).trim()) out.push(text.slice(start));
  return out;
}

/** Index of the `key:` colon at depth zero of an object entry, or -1. */
function findKeyColon(part: string): number {
  let depth = 0;
  let i = 0;
  while (i < part.length) {
    const ch = part[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i++;
      while (i < part.length && part[i] !== quote) {
        if (part[i] === '\\') i++;
        i++;
      }
    } else if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === ':' && depth === 0) return i;
    i++;
  }
  return -1;
}

/** Converts every template literal in an expression to string
 * concatenation — wxml {{}} has no backticks. Handles nesting
 * (`` `a${ `b` }c` ``) and escapes. */
export function convertTemplateLiterals(expr: string): string {
  if (!expr.includes('`')) return expr;
  let out = '';
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < expr.length && expr[j] !== ch) {
        if (expr[j] === '\\') j++;
        j++;
      }
      out += expr.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === '`') {
      const [inner, next] = scanTemplateLiteral(expr, i);
      out += '(' + templateParts(inner) + ')';
      i = next;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Content between the backticks at `start`, with ${} interpolations kept
 * (nested backticks inside them stay verbatim — templateParts recurses). */
function scanTemplateLiteral(code: string, start: number): [string, number] {
  let i = start + 1;
  let inner = '';
  let depth = 0;
  while (i < code.length) {
    const ch = code[i];
    if (ch === '\\') {
      inner += ch + (code[i + 1] ?? '');
      i += 2;
      continue;
    }
    if (depth === 0 && ch === '`') return [inner, i + 1];
    if (ch === '$' && code[i + 1] === '{') {
      depth++;
      inner += '${';
      i += 2;
      continue;
    }
    if (depth > 0 && ch === '}') depth--;
    inner += ch;
    i++;
  }
  return [inner, i];
}

/** `` a${b}c `` -> `'a' + (b) + 'c'`. Literal chunks re-quote as single
 * strings; interpolation expressions recurse through
 * convertTemplateLiterals for nested backticks. */
function templateParts(inner: string): string {
  const parts: string[] = [];
  let lit = '';
  let i = 0;
  const flush = () => {
    if (lit) {
      const escaped = lit.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      parts.push(`'${escaped}'`);
    }
    lit = '';
  };
  while (i < inner.length) {
    const ch = inner[i];
    if (ch === '$' && inner[i + 1] === '{') {
      flush();
      let depth = 1;
      let j = i + 2;
      let expr = '';
      while (j < inner.length && depth > 0) {
        if (inner[j] === '{') depth++;
        else if (inner[j] === '}') {
          depth--;
          if (depth === 0) break;
        }
        expr += inner[j];
        j++;
      }
      parts.push('(' + convertTemplateLiterals(expr.trim()) + ')');
      i = j + 1;
      continue;
    }
    lit += ch;
    i++;
  }
  flush();
  return parts.join(' + ') || "''";
}

/** Whole-expression form (`` `...` ``) kept for the :class/:style branches. */
function templateLiteralToConcat(expr: string): string {
  return convertTemplateLiterals(expr);
}

/** Inline expression for {{}}/attrs: extract anything containing a call into
 * a computed (wxml cannot call functions), otherwise pass through verbatim. */
function inlineExpr(expr: string, ctx: Ctx, scope: Scope): string {
  const trimmed = convertTemplateLiterals(expr.trim());
  // v-for scope vars must stay in wxml (an instance-level computed cannot
  // see them); concatenation without backticks is wxml-safe verbatim
  const forScoped = freeScopeIdentifiers(trimmed, ctx.bindings, new Set(GLOBAL_IDENTIFIERS)).some(
    (v) => scope.forVars.has(v),
  );
  if (!forScoped && /\(/.test(trimmed) && !/^['"]/.test(trimmed)) {
    const name = `__d${ctx.counters.d++}`;
    ctx.setupCode.push(computedSrc(name, rewritten(trimmed, ctx, scope)));
    ctx.returnedNames.push(name);
    trackData(ctx, trimmed);
    return name;
  }
  trackData(ctx, trimmed);
  return trimmed;
}

function computedSrc(name: string, body: string): string {
  return `const ${name} = __fjsComputed(() => ${body});`;
}

function rewritten(expr: string, ctx: Ctx, scope: Scope): string {
  return rewriteExpr(expr, { bindings: ctx.bindings, skip: scope.forVars });
}

function findDir(node: TemplateChildNode, name: string): DirectiveNode | undefined {
  if (node.type !== NodeTypes.ELEMENT) return undefined;
  return (node as ElementNode).props.find(
    (p): p is DirectiveNode => p.type === NodeTypes.DIRECTIVE && p.name === name,
  );
}

function dirArg(d: DirectiveNode): string | undefined {
  if (!d.arg) return undefined;
  return d.arg.type === NodeTypes.SIMPLE_EXPRESSION
    ? d.arg.content
    : String((d.arg as unknown as { content?: string }).content ?? '');
}

/** Raw (untransformed) parse output only ever produces simple expression
 * nodes; the union type just reflects post-transform shapes. */
function exprContent(exp: ExpressionNode | undefined): string {
  return exp && exp.type === NodeTypes.SIMPLE_EXPRESSION
    ? (exp as SimpleExpressionNode).content
    : '';
}

function staticAttr(el: ElementNode, name: string): string | null {
  const a = el.props.find(
    (p): p is AttributeNode => p.type === NodeTypes.ATTRIBUTE && p.name === name,
  );
  return a?.value?.content ?? null;
}

function toKebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

function kebabAttr(name: string): string {
  if (/^(data-|wx:|aria-)/.test(name)) return name;
  return toKebab(name);
}

/** WXML text nodes are RAW: entities are not decoded (`&lt;` renders
 * literally) and a bare `<` reads like a tag start. Decode the HTML
 * entities Vue templates legitimately use, then emit anything containing
 * < or > as a string interpolation. */
const TEXT_ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
};

function decodeTextEntities(text: string): string {
  return text.replace(/&([a-z]+);/g, (m, name: string) => TEXT_ENTITIES[name] ?? m);
}

function escapeText(text: string): string {
  const decoded = decodeTextEntities(text);
  if (!decoded.includes('<') && !decoded.includes('>')) return decoded;
  const quote = decoded.includes("'") ? '"' : "'";
  if (!decoded.includes(quote) && !decoded.includes('{{') && !decoded.includes('}}')) {
    return `{{ ${quote}${decoded}${quote} }}`;
  }
  // hostile edge (both quotes / braces in text): keep entities, they at
  // least parse — display degrades instead of breaking the file
  return text;
}

function escapeAttr(text: string): string {
  // WXML attributes are not entity-decoded either; & must stay raw or
  // expressions like `a && b` would corrupt. Only the quote needs care.
  return text.replace(/"/g, '&quot;');
}
