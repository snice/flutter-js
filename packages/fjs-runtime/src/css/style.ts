// Style engine: stores rules parsed from <style> blocks, matches them
// against elements, and computes each element's final style object
// (cascade by specificity + source order, then CSS inheritance along the
// element tree). The Vue renderer feeds element state (tag/class/scopes/
// inline style) and applies computed styles back through setProps, so the
// native bridge keeps receiving exactly one merged `style` map per element.
import { normalizeValue, parseInlineCss, parseStylesheet, warnOnce, type CssRule, type Selector } from './parser';

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
  computedKeys?: string[]; // `computed`'s own keys (see ComputeResult.keys)
  appliedKeys?: string[]; // `applied`'s own keys
  activeKeys?: string[]; // `activeComputed`'s own keys
  appliedActiveKeys?: string[];
  activeComputed?: Record<string, unknown>; // the same style while pressed (:active), if any
  chainKey?: string; // matching-relevant signature of self + ancestor chain
  chainId?: number; // interned id of chainKey (keeps ancestor keys O(1))
  matched?: MatchResult; // last match, reusable while the inputs below hold
  matchedParentChainId?: number;
  matchedEpoch?: number;
  defaultsId?: number; // identity token of `defaults`
  computedId?: number; // identity token of `computed`
  customId?: number; // identity token of `custom`
  selfSig?: string; // cached `tag|classes|scopes` part of the chain key
  dirtyEpoch?: number; // which pending set this element is already in
  applied?: Record<string, unknown>; // last style actually pushed to native
  appliedActive?: Record<string, unknown>; // last :active style pushed to native
}

interface MatchResult {
  decls: Record<string, unknown>;
  custom: Record<string, string>;
  /** The same cascade with the `:active` rules folded in, present only when
   * a selector actually matched with one. */
  activeDecls?: Record<string, unknown>;
  id: number; // identity token for the compute cache key
  /** Computed styles for this rule set, keyed by the PARENT's computed-style
   * id. That one number is a complete key: a parent's computed style and its
   * custom properties are minted together, and the tag (hence its default
   * style) is already part of the chain key this result is cached under. It
   * replaces a per-element template string plus a global map lookup. */
  byParent: Map<number, ComputeResult>;
}

interface ComputeResult {
  style: Record<string, unknown>;
  /** `style`'s own keys, taken once here so the per-element comparison in
   * recompute() never has to enumerate an object. Computed styles are shared
   * and immutable, so this costs one array per distinct style rather than
   * one per element. */
  keys: string[];
  activeStyle?: Record<string, unknown>;
  activeKeys?: string[];
  custom?: Record<string, string>;
  styleId: number;
  customId: number;
  defaultsId: number;
}

/** What one flush did. Cache hit rates are the thing to look at: the engine
 * is built so that N similar elements collapse onto one computed style, and
 * when that stops happening the per-node cost jumps by an order of magnitude
 * with nothing else looking different. */
export interface StyleEngineStats {
  /** Elements visited by a recompute pass. */
  recompute: number;
  computeHit: number;
  computeMiss: number;
  matchHit: number;
  matchMiss: number;
  /** Elements whose style actually crossed the bridge. */
  applied: number;
  /** Elements the engine is tracking, and rules it is matching against. */
  elements: number;
  rules: number;
  /** Wall time inside recompute passes, and how many passes ran. One clock
   * pair per pass, so this is free to leave on — and it answers the first
   * question anyone has about a slow restyle: was it even the engine? */
  flushMs: number;
  flushes: number;
  /** Wall time in markDirty's subtree walks, how many walks ran, and how
   * many nodes they visited. This happens during the framework's patch, not
   * during the recompute pass, so it is invisible to [flushMs]. */
  markMs: number;
  markCalls: number;
  markVisited: number;
}

export class StyleEngine {
  private rules: CssRule[] = [];
  private nextOrder = 0;
  private states = new Map<number, ElementState>();
  /** Dirty elements as a plain array, deduplicated by stamping the element
   * rather than hashing it. A Set here grew to the size of the tree on every
   * restyle and was then copied out again to be sorted; on a device the
   * allocation that costs more than the work. */
  private dirtyList: number[] = [];
  private dirtyEpoch = 1;
  private flushQueued = false;
  private matchCache = new Map<string, MatchResult>();
  /** chainKey -> small integer, so a child's key embeds its parent's id
   * instead of the parent's whole key (mount builds one key per element and
   * deep trees made those strings grow with depth). */
  private chainIds = new Map<string, number>();
  private nextChainId = 1;
  /** Bumped when the stylesheet changes, which invalidates every element's
   * remembered match without having to walk them. */
  private matchEpoch = 1;
  /** Identity tokens for the objects the compute cache keys on. Numbers
   * (assigned where each object is created) keep the key a short string and
   * the lookup allocation-free. */
  private nextObjId = 1;
  private defaultsIds = new WeakMap<object, number>();
  /** Reused by markDirty so a walk allocates nothing. */
  private walkStack: number[] = [];
  private counters = { recompute: 0, computeHit: 0, computeMiss: 0, matchHit: 0, matchMiss: 0, applied: 0, flushMs: 0, flushes: 0, markMs: 0, markCalls: 0, markVisited: 0 };

  /** Counters since [resetStats]. Cheap enough to leave on (a few integer
   * increments per element); `examples/hello-fjs`'s theme page reads them. */
  get stats(): StyleEngineStats {
    return {
      ...this.counters,
      elements: this.states.size,
      rules: this.rules.length,
    };
  }

  resetStats(): void {
    this.counters = { recompute: 0, computeHit: 0, computeMiss: 0, matchHit: 0, matchMiss: 0, applied: 0, flushMs: 0, flushes: 0, markMs: 0, markCalls: 0, markVisited: 0 };
  }

  constructor(
    private readonly parentOf: Map<number, number | null>,
    private readonly childrenOf: Map<number, number[]>,
    private readonly applyStyle: (
      id: number,
      style: Record<string, unknown>,
      activeStyle: Record<string, unknown> | null,
    ) => void,
  ) {}

  /** Registers a <style> block. scope=null means global (non-scoped). */
  register(scope: string | null, cssText: string): void {
    const parsed = parseStylesheet(cssText, scope, this.nextOrder);
    if (parsed.length === 0) return;
    this.nextOrder = parsed[parsed.length - 1].order + 1;
    this.rules.push(...parsed);
    this.matchEpoch++;
    // every MatchResult (and the computed styles hanging off it) is stale
    this.matchCache.clear();
    for (const id of this.states.keys()) this.mark(id);
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
    this.mark(id);
    this.scheduleFlush();
  }

  forget(id: number): void {
    // the id may still sit in dirtyList; recompute skips ids with no state
    this.states.delete(id);
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
    if (sameMap(style, s.inline) && sameMap(custom, s.inlineCustom)) return;
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
    if (!changed && sameMap(next, s.inlineCustom)) return;
    s.inlineCustom = next;
    this.markDirty(id, true);
  }

  /** Marks `id` (and optionally its subtree) for recomputation and queues a
   * single microtask flush. Mounting touches each element several times
   * (create → addScope → class → insert); coalescing turns that from
   * O(touches × subtree) recomputes into one pass per element. */
  /** Adds an element to the pending set, once. */
  private mark(id: number): void {
    const state = this.states.get(id);
    if (state === undefined || state.dirtyEpoch === this.dirtyEpoch) return;
    state.dirtyEpoch = this.dirtyEpoch;
    this.dirtyList.push(id);
  }

  markDirty(id: number, subtree: boolean): void {
    if (subtree) {
      const clock = (globalThis as { __fjs?: { fns?: { nowMs?: () => number } } })
        .__fjs?.fns?.nowMs;
      const t0 = clock ? clock() : 0;
      // An explicit stack, an indexed loop, and no allocation for the common
      // cases. This walk is the whole subtree on every theme switch, and at
      // that size the shape of the loop was costing more than the cascade it
      // exists to schedule: a closure frame per node, an iterator object per
      // `for...of`, an empty array for every leaf's missing child list, and a
      // `seen` Set that grew to the size of the tree.
      //
      // `seen` is gone because this is a tree: trackInsert gives every child
      // exactly one parent. The visit cap is the backstop, so a cycle
      // introduced by a broken adapter degrades to a missed restyle instead
      // of a hang.
      const stack = this.walkStack;
      stack.length = 0;
      stack.push(id);
      let visited = 0;
      // The cap only guards against a cyclic childrenOf, which a broken
      // adapter could produce; it degrades to a missed restyle, not a hang.
      // So it has to be generous: this walk covers the whole NODE tree, not
      // just the styled elements, and those are different numbers — v-if
      // anchors are nodes the engine deliberately does not track. Sizing it
      // off `states` truncated real walks and silently left elements
      // unstyled, which is far worse than the hang it guards against.
      //
      // Marking "everything" past some threshold was tried and reverted: the
      // router parks tab pages instead of unmounting them, so a theme change
      // on the visible page would drag every parked page's elements into the
      // recompute with it.
      const cap = (this.parentOf.size + this.states.size) * 2 + 1024;
      while (stack.length > 0) {
        const nid = stack.pop()!;
        if (++visited > cap) {
          warnOnce('style: subtree walk hit its visit cap (cyclic tree?)');
          break;
        }
        this.mark(nid);
        const kids = this.childrenOf.get(nid);
        if (kids !== undefined) {
          for (let i = 0; i < kids.length; i++) stack.push(kids[i]);
        }
      }
      this.counters.markVisited += visited;
      if (clock) this.counters.markMs += clock() - t0;
      this.counters.markCalls++;
    } else {
      this.mark(id);
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
      const clock = (globalThis as { __fjs?: { fns?: { nowMs?: () => number } } })
        .__fjs?.fns?.nowMs;
      const t0 = clock ? clock() : 0;
      // parents are always created before children (ascending ids), so one
      // ascending pass gives every element a fresh parent computed style
      let guard = 0;
      while (this.dirtyList.length && guard++ < 100) {
        const ids = this.dirtyList;
        // a fresh list (not a copy) so anything dirtied during the pass lands
        // in the next one, under the next stamp
        this.dirtyList = [];
        this.dirtyEpoch++;
        ids.sort((a, b) => a - b);
        for (let i = 0; i < ids.length; i++) this.recompute(ids[i]);
      }
      if (clock) this.counters.flushMs += clock() - t0;
      this.counters.flushes++;
    });
  }

  private recompute(id: number): void {
    const s = this.states.get(id);
    if (!s) return;
    this.counters.recompute++;
    const merged = this.compute(id);
    s.computed = merged;
    const active = s.activeComputed;
    // Identity first. compute() hands every element that resolved to the same
    // style the same object, so "nothing changed" is usually a pointer
    // compare — and the `?? {}` spelling below allocated two objects per
    // element for the common case of no pressed variant at all.
    if (merged === s.applied && active === s.appliedActive) return;
    if (
      s.applied !== undefined &&
      sameStyle(merged, s.computedKeys!, s.applied, s.appliedKeys!) &&
      sameOptionalStyle(active, s.activeKeys, s.appliedActive, s.appliedActiveKeys)
    ) {
      return;
    }
    this.counters.applied++;
    s.applied = merged;
    s.appliedKeys = s.computedKeys;
    s.appliedActive = active;
    s.appliedActiveKeys = s.activeKeys;
    // null, not undefined: an element that stops matching every :active rule
    // has to clear the one the native side is still holding
    this.applyStyle(id, merged, active ?? null);
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
    const parentStyleId = parentComputed ? parent!.computedId! : 0;
    if (memoizable) {
      const hit = matched.byParent.get(parentStyleId);
      // defaultsId is fixed for a given match (the chain key includes the
      // tag), but a mismatch would be silent corruption, so it is checked
      if (hit && hit.defaultsId === (s.defaultsId ?? 0)) {
        this.counters.computeHit++;
        s.custom = hit.custom;
        s.computedId = hit.styleId;
        s.customId = hit.customId;
        s.activeComputed = hit.activeStyle;
        s.computedKeys = hit.keys;
        s.activeKeys = hit.activeKeys;
        return hit.style;
      }
    }
    this.counters.computeMiss++;
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
    // the pressed variant is the same pipeline over the pressed cascade, so
    // inline styles and inherited values keep winning where they should
    s.activeComputed = matched.activeDecls
      ? resolveVars(
          {
            ...inherited,
            ...(s.defaults ?? {}),
            ...matched.activeDecls,
            ...(s.inline ?? {}),
          },
          custom,
        )
      : undefined;
    s.computedId = this.nextObjId++;
    s.customId = custom ? this.nextObjId++ : 0;
    s.computedKeys = Object.keys(style);
    s.activeKeys = s.activeComputed ? Object.keys(s.activeComputed) : undefined;
    if (memoizable) {
      // Bounded: every restyle mints new parent style ids, so entries for
      // parents that no longer exist would otherwise pile up per rule set.
      if (matched.byParent.size > 64) matched.byParent.clear();
      matched.byParent.set(parentStyleId, {
        style,
        keys: s.computedKeys,
        activeStyle: s.activeComputed,
        activeKeys: s.activeKeys,
        custom,
        styleId: s.computedId,
        customId: s.customId,
        defaultsId: s.defaultsId ?? 0,
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
    // The match depends on this element's own signature and its ancestors',
    // and nothing else. A theme change touches neither, so on a restyle the
    // answer is already on the element — reusing it skips building the chain
    // key string and two map lookups for every element on the page.
    const pid = this.parentOf.get(id);
    const parentChainId = (pid != null ? this.states.get(pid)?.chainId : 0) ?? 0;
    if (
      s.matched !== undefined &&
      s.selfSig !== undefined &&
      s.matchedEpoch === this.matchEpoch &&
      s.matchedParentChainId === parentChainId
    ) {
      this.counters.matchHit++;
      return s.matched;
    }

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
    const remember = (result: MatchResult): MatchResult => {
      s.matched = result;
      s.matchedParentChainId = parentChainId;
      s.matchedEpoch = this.matchEpoch;
      return result;
    };
    const cached = this.matchCache.get(key);
    if (cached) {
      this.counters.matchHit++;
      return remember(cached);
    }
    this.counters.matchMiss++;
    // Two cascades: the plain one, and the one that also lets in whatever
    // matches only while pressed. They are folded separately because a rule
    // can match through both kinds of selector at different specificities.
    const plain: Array<{ rule: CssRule; spec: number }> = [];
    const active: Array<{ rule: CssRule; spec: number }> = [];
    let anyActive = false;
    for (const rule of this.rules) {
      // scoped rules apply to elements carrying the scope; :deep selectors
      // apply to anything inside a subtree that carries it
      let best = -1; // best selector matching in the pressed state
      let bestPlain = -1; // best one that does not need the press state
      for (const sel of rule.selectors) {
        if (rule.scope != null) {
          const has = sel.deep ? this.hasScopeUp(id, rule.scope) : s.scopes.has(rule.scope);
          if (!has) continue;
        }
        if (!this.matchSelector(sel, id)) continue;
        best = Math.max(best, sel.specificity);
        if (!sel.active) bestPlain = Math.max(bestPlain, sel.specificity);
      }
      if (best < 0) continue;
      // scoped rules win ties over global ones (like the extra [data-v]
      // attribute selector in real browsers)
      const bump = rule.scope != null ? 10 : 0;
      if (bestPlain >= 0) plain.push({ rule, spec: bestPlain + bump });
      if (best > bestPlain) anyActive = true;
      active.push({ rule, spec: best + bump });
    }
    const byCascade = (
      a: { rule: CssRule; spec: number },
      b: { rule: CssRule; spec: number },
    ) => a.spec - b.spec || a.rule.order - b.rule.order;
    plain.sort(byCascade);
    const decls: Record<string, unknown> = {};
    const custom: Record<string, string> = {};
    for (const m of plain) {
      for (const [k, v] of Object.entries(m.rule.decls)) {
        if (k.startsWith('--')) custom[normalizeVarKey(k)] = String(v);
        else decls[k] = v;
      }
    }
    // custom properties stay out of the pressed variant: they inherit, and
    // a press only restyles the node itself
    let activeDecls: Record<string, unknown> | undefined;
    if (anyActive) {
      active.sort(byCascade);
      activeDecls = {};
      for (const m of active) {
        for (const [k, v] of Object.entries(m.rule.decls)) {
          if (!k.startsWith('--')) activeDecls[k] = v;
        }
      }
    }
    const result: MatchResult = {
      decls,
      custom,
      activeDecls,
      id: this.nextObjId++,
      byParent: new Map(),
    };
    this.matchCache.set(key, result);
    return remember(result);
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

/** Value equality for two style maps, given each one's own keys.
 *
 * The keys are passed in rather than taken here because they are already
 * known: a computed style is shared and immutable, so its key list is built
 * once per distinct style instead of once per element that wears it. The
 * previous spelling took `Object.keys` of both maps on every comparison —
 * a few thousand throwaway arrays per restyle, which is the kind of thing
 * that costs nothing on a laptop and dominates on a phone. */
function sameStyle(
  a: Record<string, unknown>,
  aKeys: string[],
  b: Record<string, unknown>,
  bKeys: string[],
): boolean {
  if (a === b) return true;
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i++) {
    const k = aKeys[i];
    const va = a[k];
    const vb = b[k];
    if (va === vb) continue;
    if (va !== null && vb !== null && typeof va === 'object' && typeof vb === 'object') {
      if (JSON.stringify(va) !== JSON.stringify(vb)) return false;
      continue;
    }
    return false;
  }
  return true;
}

/** Shallow map equality for the "did this prop actually change" checks, which
 * run once per patched prop rather than once per element in a restyle — so
 * enumerating here is fine. Absent and empty count as the same thing. */
function sameMap(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): boolean {
  if (a === b) return true;
  const ak = a ? Object.keys(a) : [];
  const bk = b ? Object.keys(b) : [];
  if (ak.length !== bk.length) return false;
  return sameStyle(a ?? {}, ak, b ?? {}, bk);
}

/** [sameStyle] where either side may be absent — the `:active` variant, which
 * most elements do not have. */
function sameOptionalStyle(
  a: Record<string, unknown> | undefined,
  aKeys: string[] | undefined,
  b: Record<string, unknown> | undefined,
  bKeys: string[] | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return sameStyle(a, aKeys ?? [], b, bKeys ?? []);
}
