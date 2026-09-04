// Vue 3 custom renderer for fjs. Maps Vue vnodes onto the fjs element
// protocol: elements are native view nodes, text is a 'text' node, events
// (onTap etc.) cross as markers with handlers kept in the JS registry.
//
// App usage:
//   import { createApp, ref } from 'vue';
//   import { flutterRoot } from 'fjs/vue';
//   const root = flutterRoot();
//   createApp(App).mount(root);
import {
  createRenderer,
  type RendererOptions,
} from '@vue/runtime-core';
import { create, forgetHandlers, insert, remove, setText, setProps, setStyle, createRoot, type Element } from '../ui/element';
import { StyleEngine } from '../css/style';

type HostNode = Element;

// ---- shadow bookkeeping (parent/child answers for Vue normalization) ----

const parentOf = new Map<number, number | null>();
const childrenOf = new Map<number, number[]>();
const htmlDefaults = new Map<number, Record<string, unknown>>();

// ---- style engine (<style> blocks: cascade + inheritance) ----

const elementsById = new Map<number, Element>();
/** Shared engine instance; css-vars.ts also drives it (useCssVars). */
export const styleEngine = new StyleEngine(parentOf, childrenOf, (id, style, activeStyle) => {
  const el = elementsById.get(id);
  if (!el) return;
  // `activeStyle` only rides along for elements that some `:active` rule
  // matched; null clears one the native side is still holding
  if (activeStyle === null && !hadActiveStyle.has(id)) return setStyle(el, style);
  if (activeStyle) hadActiveStyle.add(id);
  else hadActiveStyle.delete(id);
  setStyle(el, style, activeStyle);
});

/** Elements the native side is holding an `:active` style for. */
const hadActiveStyle = new Set<number>();

/** The whole style a v-if / fragment anchor ever needs. */
const ANCHOR_STYLE = { display: 'none' };

/** Takes the child out of its current parent's child list, keeping its own
 * subtree bookkeeping (this is half of a move, not a removal). */
function trackDetach(child: HostNode) {
  const parentId = parentOf.get(child.id);
  if (parentId == null) return;
  const list = childrenOf.get(parentId);
  const idx = list ? list.indexOf(child.id) : -1;
  if (idx >= 0) list!.splice(idx, 1);
  parentOf.delete(child.id);
}

function trackInsert(parent: HostNode, child: HostNode, index: number) {
  parentOf.set(child.id, parent.id);
  const list = childrenOf.get(parent.id) ?? [];
  const at = Math.min(index, list.length);
  list.splice(at, 0, child.id);
  childrenOf.set(parent.id, list);
}

/** Drops the engine/renderer state for `id` and everything under it. The
 * native side needs no help — one Remove op takes the subtree with it. */
function forgetSubtree(id: number) {
  const stack = [id];
  while (stack.length) {
    const current = stack.pop()!;
    const kids = childrenOf.get(current);
    if (kids) for (let i = 0; i < kids.length; i++) stack.push(kids[i]);
    // the root's own parent/child bookkeeping is trackRemove's job
    if (current !== id) {
      parentOf.delete(current);
      childrenOf.delete(current);
    }
    elementsById.delete(current);
    hadActiveStyle.delete(current);
    htmlDefaults.delete(current);
    // event handlers too, and for the same reason the engine state goes:
    // Vue names only the subtree root, so nothing else would ever drop the
    // descendants'. A handler closes over its component's render scope, so
    // one leftover `@tap` keeps its whole page — every element, every
    // reactive object — alive for as long as the app runs.
    forgetHandlers(current);
    styleEngine.forget(current);
  }
}

function trackRemove(child: HostNode) {
  const parentId = parentOf.get(child.id);
  if (parentId != null) {
    const list = childrenOf.get(parentId);
    if (list) {
      const idx = list.indexOf(child.id);
      if (idx >= 0) list.splice(idx, 1);
    }
  }
  parentOf.delete(child.id);
  childrenOf.delete(child.id);
  hadActiveStyle.delete(child.id);
}

// ---- HTML tag mapping --------------------------------------------------------
//
// Vue apps may author with standard HTML tags; they are translated to the
// fjs tag set at createElement time, so `<div>/<span>/<img>` etc. work
// out of the box. Unknown tags pass through verbatim (Dart component
// registry handles them).

interface HtmlTagMapping {
  tag: string;
  style?: Record<string, unknown>;
  props?: Record<string, unknown>;
}

const H: Record<string, HtmlTagMapping> = {
  // containers
  div: { tag: 'view' },
  section: { tag: 'view' },
  main: { tag: 'view' },
  article: { tag: 'view' },
  aside: { tag: 'view' },
  nav: { tag: 'view' },
  header: { tag: 'view' },
  footer: { tag: 'view' },
  ul: { tag: 'view' },
  ol: { tag: 'view' },
  li: { tag: 'view' },
  // `label` is an fjs tag of its own now (it forwards taps); it stays in
  // this table so the defaults an HTML page relied on still apply, mapping
  // to itself. `form` is NOT here: on this path it resolves to the Vue
  // component in components/form.ts, which renders a plain view.
  table: { tag: 'view' },
  tr: { tag: 'view', style: { flexDirection: 'row' } },
  td: { tag: 'view' },
  th: { tag: 'view' },

  // text
  span: { tag: 'text' },
  p: { tag: 'text', style: { margin: 8, fontSize: 15 } },
  b: { tag: 'text', style: { fontWeight: 'bold' } },
  strong: { tag: 'text', style: { fontWeight: 'bold' } },
  em: { tag: 'text', style: { fontWeight: '500' } },
  i: { tag: 'text', style: { fontWeight: '500' } },
  small: { tag: 'text', style: { fontSize: 12 } },
  a: { tag: 'text', style: { color: '#1a73e8' } },
  h1: { tag: 'text', style: { fontSize: 28, fontWeight: 'bold' } },
  h2: { tag: 'text', style: { fontSize: 24, fontWeight: 'bold' } },
  h3: { tag: 'text', style: { fontSize: 20, fontWeight: 'bold' } },
  h4: { tag: 'text', style: { fontSize: 18, fontWeight: '600' } },
  h5: { tag: 'text', style: { fontSize: 16, fontWeight: '600' } },
  h6: { tag: 'text', style: { fontSize: 14, fontWeight: '600' } },
  br: { tag: 'text' },

  // controls (map onto native widgets)
  img: { tag: 'image' },
  // The button's chrome (padding / radius / hairline / label color) is a
  // Dart-side default now — widgets/button.dart — because a filled variant
  // (`type="primary"`) must NOT have the hairline, and a border injected
  // from here reaches Dart indistinguishable from one the page wrote.
  // A page's own `border: none` / `border-color: …` still wins, exactly as
  // before (render/style.dart resolves the two the way CSS does).
  button: { tag: 'button' },
  input: { tag: 'input' },
  // same numbers the web base stylesheet gives `label` (base-css.ts)
  label: { tag: 'label', style: { margin: 4, fontSize: 14, color: '#666666' } },
  // `textarea` used to be an alias for `input multiline`. It is a real
  // component now (components/textarea.ts); an alias here would rewrite the
  // tag before the component is ever instantiated.
  hr: { tag: 'divider' },
};

const htmlTagCache = new Map<string, { tag: string; defaults: Record<string, unknown> } | null>();

/** Resolves an HTML tag to its fjs tag + injected defaults. */
export function resolveHtmlTag(
  tag: string,
): { tag: string; defaults: Record<string, unknown> } | null {
  const cached = htmlTagCache.get(tag);
  if (cached !== undefined) return cached;
  const m = H[tag];
  // the result is shared by every element of this tag (never mutated), so
  // the style engine can key its cache on the defaults object's identity
  const resolved = m
    ? { tag: m.tag, defaults: { ...(m.style ? { style: m.style } : {}), ...(m.props ?? {}) } }
    : null;
  htmlTagCache.set(tag, resolved);
  return resolved;
}

// ---- nodeOps ---------------------------------------------------------------

const nodeOps: Omit<RendererOptions<HostNode, HostNode>, 'patchProp'> = {
  createElement: (rawTag) => {
    const mapped = resolveHtmlTag(rawTag);
    const el = create(mapped ? mapped.tag : rawTag);
    if (mapped) {
      // remember defaults; the style engine merges them ahead of matched
      // rules and user style
      htmlDefaults.set(el.id, mapped.defaults);
      if (rawTag === 'br') setText(el, '\n');
    }
    elementsById.set(el.id, el);
    styleEngine.ensure(el.id, rawTag, mapped?.defaults.style as Record<string, unknown> | undefined);
    childrenOf.set(el.id, []);
    parentOf.set(el.id, null);
    return el;
  },

  createText: (text) => {
    const el = create('text');
    if (text) setText(el, text);
    elementsById.set(el.id, el);
    styleEngine.ensure(el.id, 'text');
    return el;
  },

  createComment: (text) => {
    // v-if / fragment anchors: a view with display:none. An empty text node
    // would still take a line's height (and a flex gap) on the native side.
    //
    // Deliberately NOT registered with the style engine, and the style goes
    // over as a plain prop. An anchor is invisible, childless, and its style
    // never changes — but an inline style is exactly what makes an element
    // non-memoizable, so registering one made every anchor pay a full
    // cascade (inherit, copy the custom props, merge, resolve var()) on
    // every restyle. They are easy to overlook because nothing draws them,
    // and a list puts one in every row: on hello-fjs's theme page they were
    // 968 of 4364 elements and essentially all of the compute cache's
    // misses.
    void text;
    const el = create('view');
    elementsById.set(el.id, el);
    setProps(el, { style: ANCHOR_STYLE });
    return el;
  },

  setText: (node, text) => {
    setText(node, text);
  },

  setElementText: (node, text) => {
    // v1: element text replaces the whole content (used for {{ }} on views)
    setText(node, text);
  },

  insert: (child, parent, anchor) => {
    // Vue also calls insert to MOVE a node that is already mounted (a keyed
    // v-for reorder). The native side detaches the child before inserting it
    // at the index this computes, so the index has to be read off the list
    // WITHOUT the child in it — otherwise a node moving later in the list
    // lands one slot too far, and the shadow list ends up holding its id
    // twice.
    trackDetach(child);
    const siblings = childrenOf.get(parent.id) ?? [];
    let index = siblings.length;
    if (anchor) {
      const ai = siblings.indexOf(anchor.id);
      if (ai >= 0) index = ai;
    }
    insert(parent, child, index);
    trackInsert(parent, child, index);
    // the child just gained an ancestor chain: recompute inheritance and
    // descendant/:deep selectors for its subtree
    styleEngine.recomputeSubtree(child.id);
  },

  remove: (child) => {
    // Vue removes only the ROOT of a subtree — the descendants go with it
    // implicitly, and it never tells us about them. Their engine state does
    // not go anywhere on its own: forgetting just this node leaves every
    // element of every unmounted page registered forever, and a later
    // restyle keeps walking and recomputing them. Measured on the theme
    // page: one switch between two list containers took `elements` from
    // 3510 to 6798.
    forgetSubtree(child.id);
    trackRemove(child);
    remove(child);
  },

  parentNode: (node) => {
    const parentId = parentOf.get(node.id);
    if (parentId == null) return null;
    // reconstruct a lightweight handle for the parent
    return makeHandle(parentId);
  },

  nextSibling: (node) => {
    const parentId = parentOf.get(node.id);
    if (parentId == null) return null;
    const list = childrenOf.get(parentId) ?? [];
    const idx = list.indexOf(node.id);
    if (idx < 0 || idx + 1 >= list.length) return null;
    return makeHandle(list[idx + 1]);
  },

  querySelector: () => null, // not supported (no DOM)

  // scoped CSS: Vue calls this for every element inside a component whose
  // SFC defines <style scoped> (id comes from __sfc__.__scopeId)
  setScopeId: (el, scopeId) => {
    if (typeof scopeId === 'string' && scopeId) styleEngine.addScope(el.id, scopeId);
  },
};

// Handles for parentNode/nextSibling: Vue only reads identity/ordering from
// them, so a minimal Element-shaped object is enough.
function makeHandle(id: number): HostNode {
  return {
    id,
    tag: 'view',
    appendChild: () => {
      throw new Error('handle is read-only');
    },
    removeChild: () => {
      throw new Error('handle is read-only');
    },
    setText: () => {
      throw new Error('handle is read-only');
    },
    setProps: () => {
      throw new Error('handle is read-only');
    },
  } as unknown as HostNode;
}

// ---- patchProp ---------------------------------------------------------------

/** Vue hands us raw attribute keys (`:on-tap` stays 'on-tap'); the element
 * API expects camelCase (onTap). HTML event names map to native ones. */
function camelize(key: string): string {
  return key.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
}

const HTML_EVENT_ALIASES: Record<string, string> = {
  onClick: 'onTap',
  onInput: 'onTextChanged',
  onChange: 'onValueChanged',
  onReset: 'onFormReset',
};

/** `@submit` means two different things: on an input it is the keyboard's
 * return key (textSubmitted, payload = the text), on a form it is the
 * collected `{name: value}` JSON. Same spelling, different event number —
 * so the alias has to look at the tag.
 *
 * `@change` is the same story: on a control it is the value that changed,
 * on a swiper it is the page. The web adapter emits `change` from the
 * swiper too, so without this the same template would work on web and be
 * dead on Flutter — the handler would sit under the wrong event number and
 * nothing would ever call it. */
function aliasEvent(tag: string, prop: string): string {
  if (prop === 'onSubmit') return tag === 'form' ? 'onFormSubmit' : prop;
  if (prop === 'onChange' && tag === 'swiper') return 'onPageChanged';
  return HTML_EVENT_ALIASES[prop] ?? prop;
}

export const patchProp: RendererOptions<HostNode, HostNode>['patchProp'] = (
  el,
  key,
  prevValue,
  nextValue,
) => {
  void prevValue;
  const prop = camelize(key);
  if (prop === 'class') {
    // Vue hands us the normalized class string; the style engine matches
    // CSS rules against it
    styleEngine.setClasses(el.id, nextValue);
    return;
  }
  if (prop === 'href' || prop === 'srcset') {
    return; // unsupported in v1
  }
  if (prop === 'id') {
    // no selector engine matches on it, but a touch event reports it as
    // `event.target.id`, the way the DOM does
    setProps(el, { id: nextValue == null ? null : String(nextValue) });
    return;
  }
  if (prop === 'src' || prop === 'value' || prop === 'placeholder') {
    setProps(el, { [prop]: nextValue });
    return;
  }
  if (prop.startsWith('on')) {
    const native = aliasEvent(el.tag, prop);
    if (nextValue == null) {
      // detach: marker false + drop registry entry (handled in setProps util)
      setProps(el, { [native]: null });
    } else {
      setProps(el, { [native]: nextValue });
    }
    return;
  }
  if (prop === 'style') {
    // object or inline CSS string; the engine merges tag defaults, matched
    // rules, inherited values and inline style before crossing the bridge
    styleEngine.setInlineStyle(el.id, nextValue);
    return;
  }
  setProps(el, { [prop]: nextValue });
};

// ---- public API ---------------------------------------------------------------

const { createApp: rendererCreateApp, render } = createRenderer<HostNode, HostNode>({
  ...nodeOps,
  patchProp,
});

export function createApp(...args: Parameters<typeof rendererCreateApp>) {
  return rendererCreateApp(...args);
}

/** Creates the flutter root container element and returns it as the mount
 * target. All Vue updates flush to native in batched frames. */
/** The JS-side shadow tree, for components that have to reason about a
 * SUBTREE rather than their own slots — `<form>` is the case: on Flutter its
 * fields are elements (not components), and they can sit any number of
 * page components deep, so slots and provide/inject cannot find them.
 * @internal used by components/form.ts */
export function childElementIds(id: number): readonly number[] {
  return childrenOf.get(id) ?? [];
}

/** @internal used by components/form.ts */
export function elementTag(id: number): string | undefined {
  return elementsById.get(id)?.tag;
}

/** @internal used by components/form.ts */
export function elementById(id: number): Element | undefined {
  return elementsById.get(id);
}

export function flutterRoot(tag = 'view'): HostNode {
  const root = createRoot(tag);
  childrenOf.set(root.id, []);
  parentOf.set(root.id, null);
  return root;
}

/** Registers a SFC <style> block with the style engine (called by the code
 * the fjs esbuild plugin injects). scope=null means a global (non-scoped)
 * block. */
export function registerStyles(scope: string | null, cssText: string): void {
  styleEngine.register(scope, cssText);
}

/** Manual render escape hatch (mostly for tests). */
export { render };
