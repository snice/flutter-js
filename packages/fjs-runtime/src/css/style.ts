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
  /** Renderer-synthesized bare-text element (`createText`); excluded from
   * sibling position for structural pseudos. Explicit `<text>` is not. */
  rawText?: boolean;
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
  hoverKeys?: string[]; // `hoverComputed`'s own keys
  appliedHoverKeys?: string[];
  hoverComputed?: Record<string, unknown>; // the same style while hovered (:hover), if any
  /** True once the element has matched a `:hover` rule. Unlike `:active`
   * (a fixed-width slot in op 8), hover crosses as its own op, so the
   * engine only sends it for elements that actually have one — `undefined`
   * in applyStyle means "never had a hover variant, say nothing". */
  hadHover?: boolean;
  chainKey?: string; // matching-relevant signature of self + ancestor chain
  chainId?: number; // interned id of chainKey (keeps ancestor keys O(1))
  matched?: MatchResult; // last match, reusable while the inputs below hold
  matchedParentChainId?: number;
  matchedEpoch?: number;
  defaultsId?: number; // identity token of `defaults`
  computedId?: number; // identity token of `computed`
  customId?: number; // identity token of `custom`
  selfSig?: string; // cached `tag|classes|scopes` part of the chain key
  structBits?: number; // last seen first/last bits (selfSig embeds them)
  dirtyEpoch?: number; // which pending set this element is already in
  applied?: Record<string, unknown>; // last style actually pushed to native
  appliedActive?: Record<string, unknown>; // last :active style pushed to native
  appliedHover?: Record<string, unknown>; // last :hover style pushed to native
}

interface MatchResult {
  decls: Record<string, unknown>;
  custom: Record<string, string>;
  /** The same cascade with the `:active` rules folded in, present only when
   * a selector actually matched with one. */
  activeDecls?: Record<string, unknown>;
  /** Same shape for `:hover` rules. */
  hoverDecls?: Record<string, unknown>;
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
  hoverStyle?: Record<string, unknown>;
  hoverKeys?: string[];
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
  /** True once a registered stylesheet contains `:first-child`/`:last-child`.
   * Sibling position is then part of the match key and every tree mutation
   * re-marks siblings; with the flag off both costs stay at zero. */
  private hasStructural = false;
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
  private chainRefs = new Map<string, number>();
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
      // undefined = the element never had a hover variant (send nothing);
      // null = clear the variant the host is holding
      hoverStyle?: Record<string, unknown> | null,
    ) => void,
  ) {}

  /** Registers a <style> block. scope=null means global (non-scoped). */
  register(scope: string | null, cssText: string): void {
    const parsed = parseStylesheet(cssText, scope, this.nextOrder);
    if (parsed.length === 0) return;
    this.nextOrder = parsed[parsed.length - 1].order + 1;
    this.rules.push(...parsed);
    if (!this.hasStructural) {
      for (const r of parsed) {
        if (r.selectors.some((s) => s.compounds.some((c) => c.first || c.last))) {
          this.hasStructural = true;
          break;
        }
      }
    }
    this.matchEpoch++;
    // every MatchResult (and the computed styles hanging off it) is stale
    this.matchCache.clear();
    for (const id of this.states.keys()) this.mark(id);
    this.scheduleFlush();
  }

  /** Registers an element created by the renderer. `tag` is the ORIGINAL
   * tag the user wrote (div, span, ...) so CSS selectors match it. `rawText`
   * marks a text element the renderer synthesized for bare string content
   * (`createText`), as opposed to an explicit `<text>` the page wrote: raw
   * text is a real element in the fjs tree but a plain text node in the
   * browser DOM, so it must not count for `:first-child`/`:last-child`
   * position (see the plan's two mixing cases). */
  ensure(id: number, tag: string, defaults?: Record<string, unknown>, rawText?: boolean): void {
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
      rawText,
    });
    this.mark(id);
    this.scheduleFlush();
  }

  /** Sibling structure changed under `parentId` (insert / remove / v-for
   * move): every child's `:first-child`/`:last-child` position may have
   * flipped. Marks the registered children; each recompute compares fresh
   * position bits against the cached ones and only elements that actually
   * moved pay for a subtree re-key. No-op while no structural rules exist. */
  noteStructureChange(parentId: number): void {
    if (!this.hasStructural) return;
    const kids = this.childrenOf.get(parentId);
    if (kids === undefined) return;
    for (let i = 0; i < kids.length; i++) this.mark(kids[i]);
    this.scheduleFlush();
  }

  /** @internal Test/diagnostic view of cache sizes. */
  cacheStatsForTest(): { matchCache: number; chainIds: number; byParent: number } {
    let byParent = 0;
    for (const m of this.matchCache.values()) byParent += m.byParent.size;
    return {
      matchCache: this.matchCache.size,
      chainIds: this.chainIds.size,
      byParent,
    };
  }

  forget(id: number): void {
    // the id may still sit in dirtyList; recompute skips ids with no state
    const s = this.states.get(id);
    if (!s) return;
    this.releaseChain(s);
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
    const { style, custom } = normalizeInline(value);
    if (sameMap(style, s.inline) && sameMap(custom, s.inlineCustom)) return;
    s.inline = style;
    s.inlineCustom = custom;
    this.markDirty(id, true);
  }

  /** The DOM's patchStyle semantics for a `:style` re-patch: an object
   * binding DIFFS against its previous value (set the next keys, drop the
   * keys that disappeared), so a key the binding did not change keeps
   * whatever wrote it in between — on a real DOM that is what makes
   * `el.style` writes from a library like @vueuse/motion survive a parent
   * re-render, and the shim needs the same here. A css string or a clear
   * replaces wholesale, like cssText. */
  patchInlineStyle(id: number, prev: unknown, next: unknown): void {
    const s = this.states.get(id);
    if (!s) return;
    if (typeof next !== 'object' || next === null) {
      if (next == null) {
        // a cleared binding removes exactly the keys it had before — other
        // consumers' writes stay
        const { style, custom } = normalizeInline(prev);
        if (!style && !custom) return;
        const inline = { ...(s.inline ?? {}) };
        const inlineCustom = { ...(s.inlineCustom ?? {}) };
        for (const key of Object.keys(style ?? {})) delete inline[key];
        for (const key of Object.keys(custom ?? {})) delete inlineCustom[normalizeVarKey(key)];
        if (sameMap(inline, s.inline) && sameMap(inlineCustom, s.inlineCustom)) return;
        s.inline = inline;
        s.inlineCustom = inlineCustom;
        this.markDirty(id, true);
      } else {
        // a css string replaces wholesale, like cssText
        this.setInlineStyle(id, next);
      }
      return;
    }
    const { style: prevStyle, custom: prevCustom } = normalizeInline(prev);
    const { style: nextStyle, custom: nextCustom } = normalizeInline(next);
    const inline: Record<string, unknown> = { ...(s.inline ?? {}), ...nextStyle };
    const custom: Record<string, string> = { ...(s.inlineCustom ?? {}), ...nextCustom };
    for (const key of Object.keys(prevStyle ?? {})) {
      if (!(key in (nextStyle ?? {}))) delete inline[key];
    }
    for (const key of Object.keys(prevCustom ?? {})) {
      if (!(key in (nextCustom ?? {}))) delete custom[key];
    }
    if (sameMap(inline, s.inline) && sameMap(custom, s.inlineCustom)) return;
    s.inline = inline;
    s.inlineCustom = custom;
    this.markDirty(id, true);
  }

  /** The element's current inline layer, for the DOM-shaped `el.style` shim
   * to read back (ui/element.ts). Inline properties plus the `--`-prefixed
   * custom ones; this is the WRITE record, not the resolved cascade — the
   * DOM's getComputedStyle semantics are out of scope for the shim. */
  inlineRecord(id: number): Record<string, unknown> | undefined {
    const s = this.states.get(id);
    if (!s) return undefined;
    if (!s.inline && !s.inlineCustom) return undefined;
    return { ...s.inline, ...s.inlineCustom };
  }

  /** One-property write on the inline layer, same contract as a `:style`
   * object key (camelCase or kebab, custom props with `--`). `null`/`''`
   * removes. This is what `el.style[key] = v` funnels into, so a DOM
   * library, a `:style` binding and useCssVars all merge into one record
   * and re-resolve together instead of clobbering each other. */
  mutateInline(id: number, key: string, value: unknown): void {
    const s = this.states.get(id);
    if (!s) {
      // Every renderer-created element is ensure()d at createElement; an
      // unregistered id means a raw element API user the style engine was
      // never told about. Dropping the write silently would be a
      // constitution V bug.
      warnOnce(
        `el.style write for element #${id} ignored: the element was never registered with the style engine (raw element API?)`,
      );
      return;
    }
    const inline: Record<string, unknown> = { ...(s.inline ?? {}) };
    const custom: Record<string, string> = { ...(s.inlineCustom ?? {}) };
    if (key.startsWith('--')) {
      const name = normalizeVarKey(key);
      if (value == null || value === '') delete custom[name];
      else custom[name] = String(value);
    } else if (value == null || value === '') {
      delete inline[key];
    } else {
      inline[key] = value;
    }
    if (sameMap(inline, s.inline) && sameMap(custom, s.inlineCustom)) return;
    s.inline = inline;
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
    const hover = s.hoverComputed;
    // Identity first. compute() hands every element that resolved to the same
    // style the same object, so "nothing changed" is usually a pointer
    // compare — and the `?? {}` spelling below allocated two objects per
    // element for the common case of no pressed variant at all.
    if (merged === s.applied && active === s.appliedActive && hover === s.appliedHover) return;
    if (
      s.applied !== undefined &&
      sameStyle(merged, s.computedKeys!, s.applied, s.appliedKeys!) &&
      sameOptionalStyle(active, s.activeKeys, s.appliedActive, s.appliedActiveKeys) &&
      sameOptionalStyle(hover, s.hoverKeys, s.appliedHover, s.appliedHoverKeys)
    ) {
      return;
    }
    this.counters.applied++;
    s.applied = merged;
    s.appliedKeys = s.computedKeys;
    s.appliedActive = active;
    s.appliedActiveKeys = s.activeKeys;
    s.appliedHover = hover;
    s.appliedHoverKeys = s.hoverKeys;
    // null, not undefined: an element that stops matching every :active rule
    // has to clear the one the native side is still holding
    this.applyStyle(id, merged, active ?? null, s.hadHover ? hover ?? null : undefined);
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
        s.hoverComputed = hit.hoverStyle;
        s.hoverKeys = hit.hoverKeys;
        if (hit.hoverStyle) s.hadHover = true;
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
    // inline styles and inherited values keep winning where they should.
    // :hover computes the same way; both state variants keep custom
    // properties out (they inherit, and a state only restyles the node).
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
    s.hoverComputed = matched.hoverDecls
      ? resolveVars(
          {
            ...inherited,
            ...(s.defaults ?? {}),
            ...matched.hoverDecls,
            ...(s.inline ?? {}),
          },
          custom,
        )
      : undefined;
    if (s.hoverComputed) s.hadHover = true;
    s.computedId = this.nextObjId++;
    s.customId = custom ? this.nextObjId++ : 0;
    s.computedKeys = Object.keys(style);
    s.activeKeys = s.activeComputed ? Object.keys(s.activeComputed) : undefined;
    s.hoverKeys = s.hoverComputed ? Object.keys(s.hoverComputed) : undefined;
    if (memoizable) {
      // Bounded: every restyle mints new parent style ids, so entries for
      // parents that no longer exist would otherwise pile up per rule set.
      if (matched.byParent.size > 64) matched.byParent.clear();
      matched.byParent.set(parentStyleId, {
        style,
        keys: s.computedKeys,
        activeStyle: s.activeComputed,
        activeKeys: s.activeKeys,
        hoverStyle: s.hoverComputed,
        hoverKeys: s.hoverKeys,
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
      // Sibling position joins the signature only when some rule cares.
      // Without the gate, every list row would pay the sibling scan and the
      // key would churn on every reorder for nothing.
      if (this.hasStructural) sig += `\u0004${this.structuralBits(id, s)}`;
      s.selfSig = sig;
    }
    return `${parentId}\u0003${sig}`;
  }

  /** Bit 0 = last child, bit 1 = first child, among the parent's children
   * that participate in structural position: registered (v-if comment
   * anchors are not) and not raw-text elements. A parentless element is
   * both — on web the page root is `#app`'s first (and last) child. */
  private structuralBits(id: number, s: ElementState): number {
    const pid = this.parentOf.get(id);
    if (pid == null) return 3;
    const kids = this.childrenOf.get(pid);
    if (kids === undefined) return 3;
    let bits = 0;
    for (let i = 0; i < kids.length; i++) {
      if (kids[i] === id) {
        bits |= 2;
        break;
      }
      const k = this.states.get(kids[i]);
      if (k !== undefined && !k.rawText) break;
    }
    for (let i = kids.length - 1; i >= 0; i--) {
      if (kids[i] === id) {
        bits |= 1;
        break;
      }
      const k = this.states.get(kids[i]);
      if (k !== undefined && !k.rawText) break;
    }
    return bits;
  }

  private matchRules(id: number, s: ElementState): MatchResult {
    // The match depends on this element's own signature and its ancestors',
    // and nothing else. A theme change touches neither, so on a restyle the
    // answer is already on the element — reusing it skips building the chain
    // key string and two map lookups for every element on the page.
    const pid = this.parentOf.get(id);
    const parentChainId = (pid != null ? this.states.get(pid)?.chainId : 0) ?? 0;
    if (this.hasStructural) {
      // Sibling position is not in the parent chain: a neighbor's
      // insert/remove leaves the parent chainId alone. The dirty element
      // itself recomputes bits here; if they moved, its cached match is
      // stale AND every descendant's chain key embeds this element's chain
      // id, so the whole subtree has to re-key. `noteStructureChange` marks
      // the siblings; this is where each one finds out whether it moved.
      const bits = this.structuralBits(id, s);
      if (s.structBits !== bits) {
        const firstBuild = s.selfSig === undefined;
        s.structBits = bits;
        s.selfSig = undefined;
        this.releaseChain(s);
        if (!firstBuild) this.markDirty(id, true);
      }
    }
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
    let chainId = this.chainIds.get(key);
    if (chainId === undefined) {
      chainId = this.nextChainId++;
      this.chainIds.set(key, chainId);
    }
    this.retainChain(s, key, chainId);
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
    // Three cascades: the plain one, and one per runtime state. Each state
    // cascade carries the rules that apply in that state, weighted by their
    // best selector UNDER that state's rules:
    //   pressed (:active)  = plain rules + :active rules. NOT hover rules —
    //     on web a touch press never matches :hover, so folding hover styles
    //     here would restyle touch press on the App differently; the widget
    //     layer adds the hover variant itself when the pointer is really over
    //     the node (FjsStyle.stateOf).
    //   hovered (:hover)   = plain rules + :hover rules. NOT :active rules —
    //     hovering is not pressing on either end.
    // Custom properties stay out of both: they inherit, and a state only
    // restyles the node itself.
    const plain: Array<{ rule: CssRule; spec: number }> = [];
    const active: Array<{ rule: CssRule; spec: number }> = [];
    const hover: Array<{ rule: CssRule; spec: number }> = [];
    let anyActive = false;
    let anyHover = false;
    for (const rule of this.rules) {
      // scoped rules apply to elements carrying the scope; :deep selectors
      // apply to anything inside a subtree that carries it
      let bestPlain = -1; // selectors with neither state flag
      let bestActive = -1; // best selector that is not hover-only
      let bestHover = -1; // best selector that is not active-only
      for (const sel of rule.selectors) {
        if (rule.scope != null) {
          const has = sel.deep ? this.hasScopeUp(id, rule.scope) : s.scopes.has(rule.scope);
          if (!has) continue;
        }
        if (!this.matchSelector(sel, id)) continue;
        const spec = sel.specificity;
        if (!sel.active && !sel.hover) bestPlain = Math.max(bestPlain, spec);
        if (!sel.hover) bestActive = Math.max(bestActive, spec);
        if (!sel.active) bestHover = Math.max(bestHover, spec);
      }
      const best = Math.max(bestPlain, bestActive, bestHover);
      if (best < 0) continue;
      // scoped rules win ties over global ones (like the extra [data-v]
      // attribute selector in real browsers)
      const bump = rule.scope != null ? 10 : 0;
      if (bestPlain >= 0) plain.push({ rule, spec: bestPlain + bump });
      if (bestActive >= 0) active.push({ rule, spec: bestActive + bump });
      if (bestHover >= 0) hover.push({ rule, spec: bestHover + bump });
      if (bestActive > bestPlain) anyActive = true;
      if (bestHover > bestPlain) anyHover = true;
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
    // custom properties stay out of the state variants: they inherit, and a
    // state only restyles the node itself
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
    // While hovered (not pressed) a :active rule must NOT apply, so the
    // hover cascade tops out at bestPlain rather than best — a rule matched
    // only through :active selectors stays out entirely (bestPlain < 0).
    let hoverDecls: Record<string, unknown> | undefined;
    if (anyHover) {
      hover.sort(byCascade);
      hoverDecls = {};
      for (const m of hover) {
        for (const [k, v] of Object.entries(m.rule.decls)) {
          if (!k.startsWith('--')) hoverDecls[k] = v;
        }
      }
    }
    const result: MatchResult = {
      decls,
      custom,
      activeDecls,
      hoverDecls,
      id: this.nextObjId++,
      byParent: new Map(),
    };
    this.matchCache.set(key, result);
    return remember(result);
  }

  private retainChain(s: ElementState, key: string, chainId: number): void {
    if (s.chainKey === key) return;
    this.releaseChain(s);
    s.chainKey = key;
    s.chainId = chainId;
    this.chainRefs.set(key, (this.chainRefs.get(key) ?? 0) + 1);
  }

  private releaseChain(s: ElementState): void {
    const key = s.chainKey;
    if (key === undefined) return;
    const refs = (this.chainRefs.get(key) ?? 1) - 1;
    if (refs <= 0) {
      this.chainRefs.delete(key);
      this.chainIds.delete(key);
      this.matchCache.delete(key);
    } else {
      this.chainRefs.set(key, refs);
    }
    s.chainKey = undefined;
    s.chainId = undefined;
    s.matched = undefined;
    s.matchedParentChainId = undefined;
    s.matchedEpoch = undefined;
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
    if (c.first || c.last) {
      const bits = this.structuralBits(id, s);
      if (c.first && !(bits & 2)) return false;
      if (c.last && !(bits & 1)) return false;
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
/** Splits an inline style value (a `:style` object or a css string) into the
 * two records the element state keeps. Absent input yields absent records. */
function normalizeInline(value: unknown): {
  style: Record<string, unknown> | undefined;
  custom: Record<string, string> | undefined;
} {
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
  return { style, custom };
}

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
