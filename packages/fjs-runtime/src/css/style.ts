// Style engine: stores rules parsed from <style> blocks, matches them
// against elements, and computes each element's final style object
// (cascade by specificity + source order, then CSS inheritance along the
// element tree). The Vue renderer feeds element state (tag/class/scopes/
// inline style) and applies computed styles back through setProps, so the
// native bridge keeps receiving exactly one merged `style` map per element.
import { normalizeValue, parseInlineCss, parseStylesheet, type CssRule, type Selector } from './parser';

/** Properties that inherit from parent to child, as in CSS. */
const INHERITABLE = new Set([
  'color',
  'fontSize',
  'fontFamily',
  'fontStyle',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'textTransform',
  'whiteSpace',
]);

interface ElementState {
  tag: string;
  classes: Set<string>;
  scopes: Set<string>;
  defaults?: Record<string, unknown>; // HTML tag default style (h1, tr, ...)
  inline?: Record<string, unknown>;
  inlineCustom?: Record<string, string>; // inline `--x` props
  custom?: Record<string, string>; // computed custom props (cascade + inherited)
  computed?: Record<string, unknown>; // last computed merged style (inheritance source for children)
  chainKey?: string; // matching-relevant signature of self + ancestor chain
  chainId?: number; // interned id of chainKey (keeps ancestor keys O(1))
  defaultsId?: number; // identity token of `defaults`
  computedId?: number; // identity token of `computed`
  customId?: number; // identity token of `custom`
  selfSig?: string; // cached `tag|classes|scopes` part of the chain key
  applied?: Record<string, unknown>; // last style actually pushed to native
}

interface MatchResult {
  decls: Record<string, unknown>;
  custom: Record<string, string>;
  id: number; // identity token for the compute cache key
}

interface ComputeResult {
  style: Record<string, unknown>;
  custom?: Record<string, string>;
  styleId: number;
  customId: number;
}

export class StyleEngine {
  private rules: CssRule[] = [];
  private nextOrder = 0;
  private states = new Map<number, ElementState>();
  private dirty = new Set<number>();
  private flushQueued = false;
  private matchCache = new Map<string, MatchResult>();
  /** chainKey -> small integer, so a child's key embeds its parent's id
   * instead of the parent's whole key (mount builds one key per element and
   * deep trees made those strings grow with depth). */
  private chainIds = new Map<string, number>();
  private nextChainId = 1;
  /** Memoized compute() results, keyed by the identities of the inputs
   * (matched rules, parent's computed style/custom props, tag defaults).
   * A list of similar rows collapses onto one shared style object, which
   * the op writer then serializes once. */
  private computeCache = new Map<string, ComputeResult>();
  /** Identity tokens for the objects the compute cache keys on. Numbers
   * (assigned where each object is created) keep the key a short string and
   * the lookup allocation-free. */
  private nextObjId = 1;
  private defaultsIds = new WeakMap<object, number>();

  constructor(
    private readonly parentOf: Map<number, number | null>,
    private readonly childrenOf: Map<number, number[]>,
    private readonly applyStyle: (id: number, style: Record<string, unknown>) => void,
  ) {}

  /** Registers a <style> block. scope=null means global (non-scoped). */
  register(scope: string | null, cssText: string): void {
    const parsed = parseStylesheet(cssText, scope, this.nextOrder);
    if (parsed.length === 0) return;
    this.nextOrder = parsed[parsed.length - 1].order + 1;
    this.rules.push(...parsed);
    this.matchCache.clear();
    this.computeCache.clear();
    for (const id of [...this.states.keys()]) this.dirty.add(id);
    this.scheduleFlush();
  }

  /** Registers an element created by the renderer. `tag` is the ORIGINAL
   * tag the user wrote (div, span, ...) so CSS selectors match it. */
  ensure(id: number, tag: string, defaults?: Record<string, unknown>): void {
    if (this.states.has(id)) return;
    let defaultsId = 0;
    if (defaults) {
      defaultsId = this.defaultsIds.get(defaults) ?? 0;
      if (defaultsId === 0) {
        defaultsId = this.nextObjId++;
        this.defaultsIds.set(defaults, defaultsId);
      }
    }
    this.states.set(id, {
      tag,
      classes: new Set(),
      scopes: new Set(),
      defaults,
      defaultsId,
    });
    this.dirty.add(id);
    this.scheduleFlush();
  }

  forget(id: number): void {
    this.states.delete(id);
    this.dirty.delete(id);
  }

  setClasses(id: number, value: unknown): void {
    const s = this.states.get(id);
    if (!s) return;
    const classes = parseClassValue(value);
    if (sameSet(classes, s.classes)) return;
    s.classes = classes;
    s.selfSig = undefined;
    this.markDirty(id, true);
  }

  setInlineStyle(id: number, value: unknown): void {
    const s = this.states.get(id);
    if (!s) return;
    let style: Record<string, unknown> | undefined;
    let custom: Record<string, string> | undefined;
    if (typeof value === 'string' && value.trim()) {
      const parsed = parseInlineCss(value);
      style = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (k.startsWith('--')) (custom ??= {})[normalizeVarKey(k)] = String(v);
        else style[k] = v;
      }
    } else if (value && typeof value === 'object') {
      style = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (k.startsWith('--')) (custom ??= {})[normalizeVarKey(k)] = String(v);
        else style[k] = v;
      }
    }
    if (sameStyle(style ?? {}, s.inline ?? {}) && sameStyle(custom ?? {}, s.inlineCustom ?? {})) return;
    s.inline = style;
    s.inlineCustom = custom;
    this.markDirty(id, true);
  }

  /** Called via the renderer's setScopeId hook: Vue marks every element of
   * a component whose SFC has <style scoped> with its data-v-xxx id. */
  addScope(id: number, scope: string): void {
    const s = this.states.get(id);
    if (!s || s.scopes.has(scope)) return;
    s.scopes.add(scope);
    s.selfSig = undefined;
    this.markDirty(id, true);
  }

  /** Merges a useCssVars() batch into the element's inline custom props
   * (keys without the leading `--` are normalized; null/'' removes). */
  setInlineCustomProps(id: number, vars: Record<string, unknown>): void {
    const s = this.states.get(id);
    if (!s) return;
    const next: Record<string, string> = { ...(s.inlineCustom ?? {}) };
    let changed = false;
    for (const [k, v] of Object.entries(vars)) {
      const name = normalizeVarKey(k.startsWith('--') ? k : `--${k}`);
      if (v == null || v === '') {
        if (name in next) {
          delete next[name];
          changed = true;
        }
        continue;
      }
      const val = String(v);
      if (next[name] !== val) {
        next[name] = val;
        changed = true;
      }
    }
    if (!changed && sameStyle(next, s.inlineCustom ?? {})) return;
    s.inlineCustom = next;
    this.markDirty(id, true);
  }

  /** Marks `id` (and optionally its subtree) for recomputation and queues a
   * single microtask flush. Mounting touches each element several times
   * (create → addScope → class → insert); coalescing turns that from
   * O(touches × subtree) recomputes into one pass per element. */
  markDirty(id: number, subtree: boolean): void {
    if (subtree) {
      const seen = new Set<number>();
      const walk = (nid: number) => {
        if (seen.has(nid)) return;
        seen.add(nid);
        if (this.states.has(nid)) this.dirty.add(nid);
        for (const child of this.childrenOf.get(nid) ?? []) walk(child);
      };
      walk(id);
    } else if (this.states.has(id)) {
      this.dirty.add(id);
    }
    this.scheduleFlush();
  }

  /** Same semantics as before (kept for external callers), but the recompute
   * itself is now coalesced into the next microtask flush. */
  recomputeSubtree(id: number): void {
    this.markDirty(id, true);
  }

  private scheduleFlush(): void {
    if (this.flushQueued) return;
    this.flushQueued = true;
    Promise.resolve().then(() => {
      this.flushQueued = false;
      // parents are always created before children (ascending ids), so one
      // ascending pass gives every element a fresh parent computed style
      let guard = 0;
      while (this.dirty.size && guard++ < 100) {
        const ids = [...this.dirty].sort((a, b) => a - b);
        this.dirty.clear();
        for (const id of ids) this.recompute(id);
      }
    });
  }

  private recompute(id: number): void {
    const s = this.states.get(id);
    if (!s) return;
    const merged = this.compute(id);
    s.computed = merged;
    if (sameStyle(merged, s.applied ?? {})) return;
    s.applied = merged;
    this.applyStyle(id, merged);
  }

  private compute(id: number): Record<string, unknown> {
    const s = this.states.get(id);
    if (!s) return {};
    // inheritance: the parent's CACHED computed style (recomputeSubtree
    // keeps parents fresh before children, so no recursion is needed —
    // re-walking the ancestor chain here made deep trees quadratic)
    const pid = this.parentOf.get(id);
    const parent = pid != null ? this.states.get(pid) : undefined;
    const parentComputed = parent?.computed;
    const parentCustom = parentComputed ? parent!.custom : undefined;
    const matched = this.matchRules(id, s);
    // Elements with no inline style of their own see a style that depends
    // only on (parent style, parent custom props, matched rules, tag
    // defaults) — all shared objects — so equal inputs reuse one result.
    const memoizable = s.inline === undefined && s.inlineCustom === undefined;
    let key = '';
    if (memoizable) {
      const parentStyleId = parentComputed ? parent!.computedId! : 0;
      const parentCustomId = parentCustom ? parent!.customId! : 0;
      key = `${parentStyleId}|${parentCustomId}|${matched.id}|${s.defaultsId ?? 0}`;
      const hit = this.computeCache.get(key);
      if (hit) {
        s.custom = hit.custom;
        s.computedId = hit.styleId;
        s.customId = hit.customId;
        return hit.style;
      }
    }
    const inherited: Record<string, unknown> = {};
    if (parentComputed) {
      for (const k of INHERITABLE) {
        const v = parentComputed[k];
        if (v !== undefined) inherited[k] = v;
      }
    }
    // CSS custom properties: cascade like normal declarations and inherit
    // down the tree, then var() references resolve against them
    let custom: Record<string, string> | undefined;
    if (parentCustom) for (const k in parentCustom) (custom ??= {})[k] = parentCustom[k];
    for (const k in matched.custom) (custom ??= {})[k] = matched.custom[k];
    const inlineCustom = s.inlineCustom;
    if (inlineCustom) for (const k in inlineCustom) (custom ??= {})[k] = inlineCustom[k];
    s.custom = custom;
    const merged: Record<string, unknown> = {
      ...inherited,
      ...(s.defaults ?? {}),
      ...matched.decls,
      ...(s.inline ?? {}),
    };
    const style = resolveVars(merged, custom);
    s.computedId = this.nextObjId++;
    s.customId = custom ? this.nextObjId++ : 0;
    if (memoizable) {
      // bounded: unique input combinations accumulate over a session
      if (this.computeCache.size > 4096) this.computeCache.clear();
      this.computeCache.set(key, {
        style,
        custom,
        styleId: s.computedId,
        customId: s.customId,
      });
    }
    return style;
  }

  /** Rebuilds the matching-relevant signature of self + the ancestor chain
   * (tags/classes/scopes). Two elements with equal chainKeys see exactly
   * the same rule set, so their matchRules results are interchangeable. */
  private buildChainKey(id: number, s: ElementState): string {
    const pid = this.parentOf.get(id);
    const parent = pid != null ? this.states.get(pid) : undefined;
    const parentId = parent?.chainId ?? 0;
    let sig = s.selfSig;
    if (sig === undefined) {
      sig = `${s.tag}\u0001${joinSorted(s.classes)}\u0001${joinSorted(s.scopes)}`;
      s.selfSig = sig;
    }
    return `${parentId}\u0003${sig}`;
  }

  private matchRules(id: number, s: ElementState): MatchResult {
    // rows in a list share one chainKey, so the whole rule scan runs once
    // per distinct tree signature instead of once per element
    const key = this.buildChainKey(id, s);
    s.chainKey = key;
    let chainId = this.chainIds.get(key);
    if (chainId === undefined) {
      chainId = this.nextChainId++;
      this.chainIds.set(key, chainId);
    }
    s.chainId = chainId;
    const cached = this.matchCache.get(key);
    if (cached) return cached;
    const matched: Array<{ rule: CssRule; spec: number }> = [];
    for (const rule of this.rules) {
      // scoped rules apply to elements carrying the scope; :deep selectors
      // apply to anything inside a subtree that carries it
      let best = -1;
      for (const sel of rule.selectors) {
        if (rule.scope != null) {
          const has = sel.deep ? this.hasScopeUp(id, rule.scope) : s.scopes.has(rule.scope);
          if (!has) continue;
        }
        if (this.matchSelector(sel, id)) best = Math.max(best, sel.specificity);
      }
      if (best < 0) continue;
      // scoped rules win ties over global ones (like the extra [data-v]
      // attribute selector in real browsers)
      matched.push({ rule, spec: best + (rule.scope != null ? 10 : 0) });
    }
    matched.sort((a, b) => a.spec - b.spec || a.rule.order - b.rule.order);
    const decls: Record<string, unknown> = {};
    const custom: Record<string, string> = {};
    for (const m of matched) {
      for (const [k, v] of Object.entries(m.rule.decls)) {
        if (k.startsWith('--')) custom[normalizeVarKey(k)] = String(v);
        else decls[k] = v;
      }
    }
    const result: MatchResult = { decls, custom, id: this.nextObjId++ };
    this.matchCache.set(key, result);
    return result;
  }

  private matchSelector(sel: Selector, id: number): boolean {
    return this.matchCompoundFrom(sel, sel.compounds.length - 1, id);
  }

  private matchCompoundFrom(sel: Selector, idx: number, id: number): boolean {
    const s = this.states.get(id);
    if (!s) return false;
    const c = sel.compounds[idx];
    if (c.tag != null && s.tag !== c.tag) return false;
    for (const cls of c.classes) {
      if (!s.classes.has(cls)) return false;
    }
    if (idx === 0) return true;
    const comb = sel.combinators[idx - 1];
    const pid = this.parentOf.get(id);
    if (pid == null) return false;
    if (comb === 'child') return this.matchCompoundFrom(sel, idx - 1, pid);
    // descendant: try every ancestor (backtracking across mixed combinators)
    let cur: number | null | undefined = pid;
    while (cur != null) {
      if (this.matchCompoundFrom(sel, idx - 1, cur)) return true;
      cur = this.parentOf.get(cur);
    }
    return false;
  }

  private hasScopeUp(id: number, scope: string): boolean {
    let cur: number | null | undefined = id;
    while (cur != null) {
      if (this.states.get(cur)?.scopes.has(scope)) return true;
      cur = this.parentOf.get(cur);
    }
    return false;
  }
}

/** Sorted join without the spread+sort allocations for the common
 * empty/single-entry sets (most elements carry 0-1 classes and scopes). */
function joinSorted(set: Set<string>): string {
  if (set.size === 0) return '';
  if (set.size === 1) {
    for (const v of set) return v;
  }
  const out: string[] = [];
  for (const v of set) out.push(v);
  out.sort();
  return out.join('\u0002');
}

function parseClassValue(value: unknown): Set<string> {
  let text = '';
  if (typeof value === 'string') text = value;
  else if (Array.isArray(value)) text = value.filter((v) => typeof v === 'string').join(' ');
  else if (value && typeof value === 'object') {
    text = Object.entries(value as Record<string, unknown>)
      .filter(([, on]) => on)
      .map(([k]) => k)
      .join(' ');
  }
  return new Set(text.split(/\s+/).filter(Boolean));
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

// ---- var() resolution --------------------------------------------------------

/** Normalizes a custom property name by resolving CSS escape sequences
 * (`theme\.color` -> `theme.color`) so escaped stylesheet references and
 * raw generated keys land on the same entry. */
function normalizeVarKey(name: string): string {
  return name.includes('\\') ? name.replace(/\\(.)/g, '$1') : name;
}

/** Replaces every var() reference in `text` using `custom` (custom prop
 * values may themselves reference vars). Returns null when a reference has
 * no value and no usable fallback — the whole declaration becomes invalid,
 * as in CSS. */
function resolveVarsInString(
  text: string,
  custom: Record<string, string>,
  depth: number,
): string | null {
  if (depth > 32) return null; // cyclic --a: var(--b) chain
  let out = '';
  let i = 0;
  while (i < text.length) {
    const idx = text.indexOf('var(', i);
    if (idx < 0) {
      out += text.slice(i);
      return out;
    }
    out += text.slice(i, idx);
    let paren = 1;
    let j = idx + 4;
    const argsStart = j;
    while (j < text.length && paren > 0) {
      const ch = text[j];
      if (ch === '(') paren++;
      else if (ch === ')') {
        paren--;
        if (paren === 0) break;
      }
      j++;
    }
    if (paren > 0) return null; // unbalanced
    const args = text.slice(argsStart, j);
    // split "name, fallback" at the first top-level comma (fallback may
    // contain commas of its own, e.g. rgba(...))
    let d = 0;
    let comma = -1;
    for (let k = 0; k < args.length; k++) {
      const ch = args[k];
      if (ch === '(') d++;
      else if (ch === ')') d--;
      else if (ch === ',' && d === 0) {
        comma = k;
        break;
      }
    }
    const name = (comma >= 0 ? args.slice(0, comma) : args).trim();
    // CSS escape sequences in the reference (\. etc.) denote the literal
    // character, so normalize before lookup — generated v-bind() getter
    // keys may be either escaped or raw depending on the compile path
    const fallback = comma >= 0 ? args.slice(comma + 1).trim() : undefined;
    let val: string | null = Object.prototype.hasOwnProperty.call(custom, normalizeVarKey(name))
      ? custom[normalizeVarKey(name)]
      : null;
    if (val != null) {
      val = resolveVarsInString(val, custom, depth + 1);
    } else if (fallback != null) {
      val = resolveVarsInString(fallback, custom, depth + 1);
    }
    if (val == null) return null;
    out += val;
    i = j + 1;
  }
  return out;
}

/** Resolves var() references in a merged style map against the element's
 * computed custom properties; unresolved declarations are dropped and
 * resolved values get the usual normalization (px -> number, ...). */
function resolveVars(style: Record<string, unknown>, custom?: Record<string, string>): Record<string, unknown> {
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(style)) {
    if (typeof v === 'string' && v.includes('var(')) {
      const resolved = resolveVarsInString(v, custom ?? {}, 0);
      if (resolved == null) {
        changed = true; // declaration becomes invalid — drop it
        continue;
      }
      out[k] = normalizeValue(k, resolved.trim());
      changed = true;
    } else {
      out[k] = v;
    }
  }
  return changed ? out : style;
}

function sameStyle(a: Record<string, unknown>, b: Record<string, unknown>): boolean {  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    const va = a[k];
    const vb = b[k];
    if (va === vb) continue;
    if (typeof va === 'object' || typeof vb === 'object') {
      if (JSON.stringify(va) !== JSON.stringify(vb)) return false;
    } else {
      return false;
    }
  }
  return true;
}
