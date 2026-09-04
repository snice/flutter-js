// Unit tests for the CSS subset engine: selector/rule parsing and the
// style engine's cascade + inheritance.
import { describe, expect, it, vi } from 'vitest';
import { parseInlineCss, parseSelector, parseStylesheet } from '../src/css/parser';
import { StyleEngine } from '../src/css/style';


/** StyleEngine coalesces updates into a microtask flush; tests await this
 * after mutating calls before asserting on applied styles. */
async function styleTick(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('parseStylesheet', () => {
  it('parses class rules with camelized keys and normalized values', () => {
    const rules = parseStylesheet(
      `.card { font-size: 16px; background: #fff; opacity: 0.5 }`,
      'data-v-1',
      0,
    );
    expect(rules).toHaveLength(1);
    expect(rules[0].scope).toBe('data-v-1');
    expect(rules[0].decls).toEqual({ fontSize: 16, background: '#fff', opacity: 0.5 });
    expect(rules[0].selectors[0]?.compounds).toEqual([{ tag: null, classes: ['card'] }]);
  });

  it('strips comments and skips at-rules', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rules = parseStylesheet(
      `/* header */ .a { color: red } @media (max-width: 600px) { .b { color: blue } }`,
      null,
      0,
    );
    expect(rules).toHaveLength(1);
    expect(rules[0].decls).toEqual({ color: 'red' });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('parses combinators and :deep()/:global()', () => {
    const sel = parseSelector('.toolbar :deep(.child > .item)')!;
    expect(sel.deep).toBe(true);
    expect(sel.compounds).toEqual([
      { tag: null, classes: ['toolbar'] },
      { tag: null, classes: ['child'] },
      { tag: null, classes: ['item'] },
    ]);
    expect(sel.combinators).toEqual(['descendant', 'child']);

    const g = parseSelector(':global(.x)')!;
    expect(g.deep).toBe(false);
    // global flag lives on the rule level via scope=null, selectors only
    // carry deep
    expect(g.compounds).toEqual([{ tag: null, classes: ['x'] }]);

    const tag = parseSelector('div.content')!;
    expect(tag.specificity).toBe(11);
  });

  it('rejects unsupported selectors instead of mis-matching them', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseSelector('.a:hover')).toBeNull();
    expect(parseSelector('input[type=text]')).toBeNull();
    expect(parseSelector('#main')).toBeNull();
    warn.mockRestore();
  });
});

describe('parseInlineCss', () => {
  it('parses style attribute strings', () => {
    expect(parseInlineCss('color: red; font-size: 14px;')).toEqual({
      color: 'red',
      fontSize: 14,
    });
  });
  it('keeps custom property keys verbatim with raw values', () => {
    const rules = parseStylesheet(`.a { --brand-color: #f00; --gap-x: 8px; color: var(--brand-color) }`, null, 0);
    expect(rules[0].decls['--brand-color']).toBe('#f00');
    expect(rules[0].decls['--gap-x']).toBe('8px');
    expect(rules[0].decls.color).toBe('var(--brand-color)');
    expect(parseInlineCss('--pad: 4; color: red')).toEqual({ '--pad': '4', color: 'red' });
  });
});

/** Builds an engine over a small fake element tree and returns helpers. */
function makeEngine() {
  const parentOf = new Map<number, number | null>();
  const childrenOf = new Map<number, number[]>();
  const applied = new Map<number, Record<string, unknown>>();
  const appliedActive = new Map<number, Record<string, unknown> | null>();
  const engine = new StyleEngine(parentOf, childrenOf, (id, style, activeStyle) => {
    applied.set(id, style);
    if (activeStyle !== undefined) appliedActive.set(id, activeStyle);
  });
  const add = (id: number, tag: string, parent: number | null) => {
    parentOf.set(id, parent);
    childrenOf.set(id, []);
    if (parent != null) childrenOf.get(parent)!.push(id);
    engine.ensure(id, tag);
    return id;
  };
  return { engine, applied, appliedActive, parentOf, childrenOf, add };
}

describe(':active', () => {
  it('parses on the subject compound and weighs as a class', () => {
    const sel = parseSelector('.list .row:active')!;
    expect(sel.active).toBe(true);
    expect(sel.compounds).toEqual([
      { tag: null, classes: ['list'] },
      { tag: null, classes: ['row'] },
    ]);
    expect(sel.specificity).toBe(30); // two classes + the pseudo-class
    expect(parseSelector('.row')!.active).toBe(false);
  });

  it('skips :active on anything but the last compound', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseSelector('.row:active .title')).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('sends the pressed cascade beside the plain one', async () => {
    const { engine, applied, appliedActive, add } = makeEngine();
    const row = add(1, 'view', null);
    engine.register(
      null,
      '.row { background-color: #fff; color: #333 } .row:active { background-color: #eee }',
    );
    engine.setClasses(1, 'row');
    await styleTick();
    expect(applied.get(row)).toMatchObject({
      backgroundColor: '#fff',
      color: '#333',
    });
    // the pressed variant is a whole style, not a diff: everything the plain
    // one has, with the :active declarations laid over it
    expect(appliedActive.get(row)).toMatchObject({
      backgroundColor: '#eee',
      color: '#333',
    });
  });

  it('keeps a more specific plain rule over a weaker :active one', async () => {
    const { engine, appliedActive, add } = makeEngine();
    const row = add(1, 'view', null);
    engine.register(null, 'view:active { color: red } .row.big { color: green }');
    engine.setClasses(1, 'row big');
    await styleTick();
    expect(appliedActive.get(row)).toMatchObject({ color: 'green' });
  });

  it('sends nothing extra for elements with no :active rule', async () => {
    const { engine, appliedActive, add } = makeEngine();
    const row = add(1, 'view', null);
    engine.register(null, '.row { color: red }');
    engine.setClasses(1, 'row');
    await styleTick();
    expect(appliedActive.get(row) ?? null).toBeNull();
  });

  it('clears the pressed style when the element stops matching', async () => {
    const { engine, appliedActive, add } = makeEngine();
    const row = add(1, 'view', null);
    engine.register(null, '.row:active { color: red }');
    engine.setClasses(1, 'row');
    await styleTick();
    expect(appliedActive.get(row)).toMatchObject({ color: 'red' });
    engine.setClasses(1, 'other');
    await styleTick();
    expect(appliedActive.get(row)).toBeNull();
  });
});

describe('StyleEngine', () => {
  it('applies scoped rules only to elements carrying the scope', async () => {
    const { engine, applied, add } = makeEngine();
    const root = add(1, 'view', null);
    engine.addScope(1, 'data-v-aa');
    engine.register('data-v-aa', '.card { color: red; font-size: 20px }');
    engine.setClasses(1, 'card');
    await styleTick();
    expect(applied.get(root)).toMatchObject({ color: 'red', fontSize: 20 });

    engine.register('data-v-bb', '.card { color: blue }');
    await styleTick();
    expect(applied.get(root)?.color).toBe('red');
  });

  it('cascades by specificity then source order', async () => {
    const { engine, applied, add } = makeEngine();
    const el = add(1, 'view', null);
    engine.setClasses(1, 'a b');
    engine.register(null, `.a { color: red; padding: 1 } .b { color: green }`);
    // .a and .b have equal specificity; .b comes later in source order
    await styleTick();
    expect(applied.get(el)?.color).toBe('green');
    await styleTick();
    expect(applied.get(el)?.padding).toBe(1);

    engine.register(null, `.b { color: blue }`);
    await styleTick();
    expect(applied.get(el)?.color).toBe('blue');
  });

  it('lets inline style and tag defaults participate in the right order', async () => {
    const { engine, applied, add } = makeEngine();
    const el = add(1, 'div', null);
    engine.ensure(1, 'div', { fontSize: 28, fontWeight: 'bold' });
    engine.register(null, `div { fontSize: 14 }`);
    await styleTick();
    expect(applied.get(el)?.fontSize).toBe(14); // rules beat tag defaults
    engine.setInlineStyle(1, 'fontSize: 18');
    await styleTick();
    expect(applied.get(el)?.fontSize).toBe(18); // inline beats rules
  });

  it('falls back to class transition after inline transition is removed', async () => {
    const { engine, applied, add } = makeEngine();
    const el = add(1, 'view', null);
    engine.register(null, '.cell { transition: transform 180ms ease }');
    engine.setClasses(1, 'cell');
    await styleTick();
    expect(applied.get(el)?.transition).toBe('transform 180ms ease');

    engine.setInlineStyle(1, { transition: 'none', transform: 'translate(8px, 0)' });
    await styleTick();
    expect(applied.get(el)).toMatchObject({
      transition: 'none',
      transform: 'translate(8px, 0)',
    });

    engine.setInlineStyle(1, { transform: 'translate(8px, 0)' });
    await styleTick();
    expect(applied.get(el)).toMatchObject({
      transition: 'transform 180ms ease',
      transform: 'translate(8px, 0)',
    });
  });

  it('inherits text properties down the tree', async () => {
    const { engine, applied, add } = makeEngine();
    const parent = add(1, 'view', null);
    const child = add(2, 'text', 1);
    engine.setInlineStyle(1, 'color: red; fontSize: 15');
    await styleTick();
    expect(applied.get(child)).toMatchObject({ color: 'red', fontSize: 15 });
    // child's own declaration wins over inheritance
    engine.setInlineStyle(2, { color: 'blue' });
    await styleTick();
    expect(applied.get(child)?.color).toBe('blue');
    await styleTick();
    expect(applied.get(parent)?.color).toBe('red');
  });

  it('matches descendant and child combinators through the tree', async () => {
    const { engine, applied, add } = makeEngine();
    add(1, 'view', null);
    add(2, 'view', 1);
    const deep = add(3, 'text', 2);
    engine.setClasses(1, 'root');
    engine.setClasses(2, 'mid');
    engine.setClasses(3, 'leaf');
    engine.register(null, `.root .leaf { color: red } .mid > .leaf { fontSize: 99 }`);
    await styleTick();
    expect(applied.get(deep)).toMatchObject({ color: 'red', fontSize: 99 });

    engine.register(null, `.leaf > .mid { color: green }`);
    await styleTick();
    expect(applied.get(deep)?.color).toBe('red'); // reversed child: no match
  });

  it('handles :deep() rules hitting child-component elements', async () => {
    const { engine, applied, add } = makeEngine();
    // scoped parent element, plain child element (no scope of its own)
    const parent = add(1, 'view', null);
    const child = add(2, 'text', 1);
    engine.addScope(1, 'data-v-aa');
    engine.setClasses(1, 'wrapper');
    engine.setClasses(2, 'inner');
    engine.register('data-v-aa', `.wrapper :deep(.inner) { color: teal }`);
    await styleTick();
    expect(applied.get(child)?.color).toBe('teal');
    await styleTick();
    expect(applied.get(parent)?.color).toBeUndefined();
  });

  it('recomputes descendants when an ancestor class changes', async () => {
    const { engine, applied, add } = makeEngine();
    const parent = add(1, 'view', null);
    const child = add(2, 'text', 1);
    engine.register(null, `.on .leaf, .leaf { fontWeight: normal } .on .leaf { color: red }`);
    engine.setClasses(2, 'leaf');
    await styleTick();
    expect(applied.get(child)).toMatchObject({ fontWeight: 'normal' });
    engine.setClasses(1, 'on');
    await styleTick();
    expect(applied.get(child)).toMatchObject({ color: 'red' });
    engine.setClasses(1, '');
    await styleTick();
    expect(applied.get(child)?.color).toBeUndefined();
  });

  it('matches against the original HTML tag name', async () => {
    const { engine, applied, add } = makeEngine();
    const el = add(1, 'div', null);
    engine.register(null, `div { lineHeight: 1.5 } p { color: red }`);
    // lineHeight stays a string so Dart can tell multipliers ("1.5") from
    // absolute heights ("24px")
    await styleTick();
    expect(applied.get(el)).toMatchObject({ lineHeight: '1.5' });
    await styleTick();
    expect(applied.get(el)?.color).toBeUndefined();
  });

  it('resolves var() against cascaded custom properties', async () => {
    const { engine, applied, add } = makeEngine();
    const el = add(1, 'view', null);
    engine.setClasses(1, 'card');
    engine.register(null, `.card { --brand: #ff0000; --pad: 8px; color: var(--brand); padding: var(--pad) }`);
    await styleTick();
    expect(applied.get(el)).toMatchObject({ color: '#ff0000', padding: 8 });
    // custom props themselves are not sent across the bridge
    await styleTick();
    expect(Object.keys(applied.get(el) ?? {})).toEqual(['color', 'padding']);
  });

  it('supports var() fallbacks and drops unresolved declarations', async () => {
    const { engine, applied, add } = makeEngine();
    const el = add(1, 'view', null);
    engine.register(null, `.a { color: var(--missing, #00ff00); fontSize: var(--nothing) }`);
    engine.setClasses(1, 'a');
    await styleTick();
    expect(applied.get(el)).toEqual({ color: '#00ff00' });
  });

  it('inherits custom properties down the tree', async () => {
    const { engine, applied, add } = makeEngine();
    add(1, 'view', null);
    const child = add(2, 'text', 1);
    engine.setClasses(1, 'card');
    engine.setClasses(2, 'title');
    engine.register(
      null,
      `.card { --brand: #0000ff } .title { color: var(--brand) }`,
    );
    await styleTick();
    expect(applied.get(child)).toMatchObject({ color: '#0000ff' });
  });

  it('merges useCssVars batches without clobbering earlier props', async () => {
    const { engine, applied, add } = makeEngine();
    const el = add(1, 'div', null);
    engine.register(null, `div { color: var(--data-v-x-brand) }`);
    // compileScript's injected getter keys are full var names (without --)
    engine.setInlineCustomProps(1, { 'data-v-x-brand': '#ff0000' });
    await styleTick();
    expect(applied.get(el)).toMatchObject({ color: '#ff0000' });
    // second batch keeps the first variable (unlike :style replacement)
    engine.setInlineCustomProps(1, { 'data-v-x-pad': '4' });
    await styleTick();
    expect(applied.get(el)).toMatchObject({ color: '#ff0000' });
    await styleTick();
    expect(applied.get(el)?.['--brand']).toBeUndefined(); // never crosses bridge
    // removing: null value deletes the var, declaration becomes invalid
    engine.setInlineCustomProps(1, { 'data-v-x-brand': null });
    await styleTick();
    expect(applied.get(el)?.color).toBeUndefined();
  });

  it('lets inline custom props and chained vars resolve', async () => {
    const { engine, applied, add } = makeEngine();
    const el = add(1, 'div', null);
    engine.register(null, `div { gap: var(--g); color: var(--brand, #123456) }`);
    engine.setInlineStyle(1, { '--g': '10px' });
    await styleTick();
    expect(applied.get(el)).toMatchObject({ gap: 10, color: '#123456' });
    // chained: --brand2 references --brand defined inline; inline style is a
    // whole-block replacement (like the :style prop), so keep --g
    engine.setInlineStyle(1, { '--g': '10px', '--brand': '#abcdef', '--brand2': 'var(--brand)' });
    engine.register(null, `div { gap: var(--g); borderColor: var(--brand2) }`);
    await styleTick();
    expect(applied.get(el)).toMatchObject({ gap: 10, borderColor: '#abcdef' });
    // cycle: safe no-crash, declarations dropped
    engine.setInlineStyle(1, { '--a': 'var(--b)', '--b': 'var(--a)' });
    await styleTick();
    expect(applied.get(el)?.borderColor).toBeUndefined();
  });

  it('normalizes CSS escapes in var names (v-bind quoted member paths)', async () => {
    const { engine, applied, add } = makeEngine();
    const el = add(1, 'div', null);
    // the plugin rewrites v-bind('theme.color') keeping the CSS escape
    // (theme\.color), while compileScript's getter keys are raw — the
    // engine must land both on the same entry
    engine.register(null, `div { color: var(--data-v-x-theme\\.color) }`);
    engine.setInlineCustomProps(1, { 'data-v-x-theme.color': '#ff0000' });
    await styleTick();
    expect(applied.get(el)).toMatchObject({ color: '#ff0000' });
    // unescaped reference matches an escaped stored key too (same entry —
    // the second batch replaces the value)
    engine.register(null, `div { borderColor: var(--data-v-x-theme.color) }`);
    engine.setInlineCustomProps(1, { 'data-v-x-theme\\.color': '#00ff00' });
    await styleTick();
    expect(applied.get(el)).toMatchObject({ color: '#00ff00', borderColor: '#00ff00' });
  });
});

// BASE_CSS is one template literal, so a stray backtick inside a CSS comment
// silently ends the string and the whole web build stops resolving. It has
// happened three times; this is cheaper than a fourth.
describe('BASE_CSS is a well-formed template literal', () => {
  it('contains no backticks', async () => {
    const { BASE_CSS } = await import('../src/web/base-css');
    expect(BASE_CSS.includes('`')).toBe(false);
  });
});
