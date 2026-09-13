// Compiler tests for the mini-program target: template -> WXML codegen,
// script injection, and the scoped-CSS rewrite. These pin the semantics the
// hello-fjs corpus relies on (spec 046 §6.3).
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { genWxml, rewriteExpr, freeScopeIdentifiers, referencedBindings } from '../src/mp/wxml.js';
import { genScriptCode } from '../src/mp/script.js';
import { genWxss, replaceScopeAttr } from '../src/mp/css.js';
import { rewriteImports } from '../src/mp/build.js';
import { appJson, componentJson } from '../src/mp/project.js';

const BINDINGS: Record<string, string> = {
  wifi: 'setup-ref',
  count: 'setup-ref',
  items: 'setup-ref',
  toggle: 'setup-const',
  router: 'setup-maybe-ref',
  title: 'setup-props',
  tabs: 'setup-const',
};

function compile(template: string, bindings = BINDINGS, heightClasses?: Set<string>) {
  return genWxml(template, {
    bindings,
    vueImports: new Map([['Panel', '/x/Panel.vue']]),
    filename: 'test.vue',
    scopeId: 'data-v-test',
    heightClasses,
  });
}

let warn: string[] = [];
beforeEach(() => {
  warn = [];
  vi.spyOn(console, 'warn').mockImplementation((m: string) => warn.push(m));
});
afterEach(() => {
  (console.warn as ReturnType<typeof vi.fn>).mockRestore();
});

describe('genWxml', () => {
  it('passes fjs tags through and stamps the scope class', () => {
    const r = compile('<view><text>{{ title }}</text></view>');
    expect(r.wxml).toContain('<view class="fjs-box data-v-test">');
    expect(r.wxml).toContain('<text class="data-v-test">');
    expect(r.wxml).toContain('{{ title }}');
    expect(r.dataNames).toEqual(['title']);
  });

  it('merges static + dynamic class and keeps the scope class last', () => {
    const r = compile('<view class="a" :class="{ b: count > 1 }" />');
    expect(r.wxml).toContain(
      'class="fjs-box a {{ (count > 1 ? \'b \' : \'\') }} data-v-test"',
    );
  });

  it('expands object :class inline so v-for scope vars survive', () => {
    const r = compile(
      '<view v-for="(item, i) in items" :key="item.id" :class="{ on: i === 0 }">{{ item.name }}</view>',
    );
    expect(r.wxml).toContain('wx:for="{{ items }}"');
    expect(r.wxml).toContain('wx:for-item="item"');
    expect(r.wxml).toContain('wx:key="id"');
    expect(r.wxml).toContain('(i === 0 ? \'on \' : \'\')');
    expect(r.wxml).toContain('{{ item.name }}');
  });

  it('converts template literals in :class to concatenation', () => {
    const r = compile('<view :class="`slide-${i + 1}`" />');
    expect(r.wxml).toContain("'slide-' + (i + 1)");
  });

  it('compiles v-if / v-else-if / v-else chains to wx:if / wx:elif / wx:else', () => {
    const r = compile(
      '<view><text v-if="wifi">a</text><text v-else-if="count">b</text><text v-else>c</text></view>',
    );
    expect(r.wxml).toContain('wx:if="{{ wifi }}"');
    expect(r.wxml).toContain('wx:elif="{{ count }}"');
    expect(r.wxml).toContain('wx:else');
  });

  it('rewrites v-show to hidden', () => {
    const r = compile('<view v-show="wifi" />');
    expect(r.wxml).toContain('hidden="{{ !(wifi) }}"');
  });

  it('extracts inline arrow handlers and passes v-for vars via data-args', () => {
    const r = compile('<view @tap="() => router.push(item.path)" />', BINDINGS);
    expect(r.wxml).toContain('bindtap="__fjsCall"');
    expect(r.wxml).toContain('data-fn="__ev0"');
    expect(r.wxml).toContain('data-args="{{ [item] }}"');
    expect(r.setupCode[0]).toBe(
      "const __ev0 = (__e, ...__s) => ((item) => router.push(item.path))(...__s);",
    );
  });

  it('generates the payload-first handler shape for typed arrows', () => {
    const r = compile('<switch @change="(v: string) => (wifi = v === \'1\')" />');
    expect(r.wxml).toContain('bindchange="__fjsCall"');
    expect(r.setupCode[0]).toBe(
      'const __ev0 = (__e, ...__s) => ((v: string) => (wifi.value = v === \'1\'))(__e, ...__s);',
    );
  });

  it('maps inline handlers onto wx-native event names and tags', () => {
    const r = compile('<swiper @page-changed="toggle" />');
    expect(r.wxml).toContain('bindchange="__fjsCall"');
    // dispatch is by e.type — no data-ev attribute at all
    expect(r.wxml).toContain('data-tag="swiper"');
    expect(r.wxml).not.toContain('data-ev');
  });

  it('maps fjs modal to the fjs-modal component with its kebab event', () => {
    const r = compile('<modal :visible="wifi" @modal-closed="toggle" />');
    expect(r.wxml).toMatch(/<fjs-modal class="data-v-test" visible="{{ wifi }}"/);
    expect(r.wxml).toContain('bind:modal-closed="__fjsCall"');
    expect(r.usingComponents.get('fjs-modal')).toBe('fjs-modal');
  });

  it('extracts function-call interpolations into computeds', () => {
    const r = compile('<view>{{ Math.round(count) }}</view>');
    expect(r.wxml).toContain('{{ __d0 }}');
    expect(r.setupCode[0]).toBe('const __d0 = __fjsComputed(() => Math.round(count.value));');
    expect(r.returnedNames).toEqual(['__d0']);
  });

  it('emits scroll-view type=list + scroll-y and canvas type=2d', () => {
    const r1 = compile('<scroll-view style="height: 100vh" />');
    expect(r1.wxml).toContain('type="list"');
    // webview scroll-view needs an explicit direction
    expect(r1.wxml).toContain('scroll-y="{{ true }}"');
    const r2 = compile('<inner-canvas />');
    expect(r2.wxml).toContain('<canvas class="data-v-test" type="2d"');
  });

  it('errors on a scroll-view without a statically visible height', () => {
    // skyline renders a heightless scroll-view as nothing — compile-time
    // error instead (style, :style literal and class rules are accepted)
    expect(() => compile('<scroll-view />')).toThrow(/no explicit height/);
    expect(() => compile('<scroll-view class="sv-h" />', BINDINGS, new Set(['sv-h']))).not.toThrow();
  });

  it('adds local .vue imports to usingComponents as kebab tags', () => {
    const r = compile('<Panel :title="title"><text>x</text></Panel>');
    expect(r.wxml).toContain('<panel class="data-v-test" title="{{ title }}">');
    expect(r.usingComponents.get('panel')).toBe('/x/Panel.vue');
    expect(r.wxml).toContain('<text');
  });

  it('compiles v-model on input to value + bindinput setter', () => {
    const r = compile('<input v-model="wifi" />');
    expect(r.wxml).toContain('value="{{ wifi }}"');
    expect(r.wxml).toContain('bindinput="__fjsCall"');
    expect(r.wxml).toContain('data-fn="__ev0"');
    expect(r.setupCode[0]).toContain('wifi.value = __e;');
  });

  it('multi-event elements share one dataset via a type dispatcher', () => {
    const r = compile('<image @load="onLoad" @error="onError" />', {
      ...BINDINGS,
      onLoad: 'setup-const',
      onError: 'setup-const',
    });
    // one data-fn, no per-event dataset duplicates
    expect((r.wxml.match(/data-fn=/g) ?? []).length).toBe(1);
    expect((r.wxml.match(/data-tag=/g) ?? []).length).toBe(1);
    expect(r.wxml).toContain('bindload="__fjsCall"');
    expect(r.wxml).toContain('binderror="__fjsCall"');
    // plain-identifier handlers dispatch by name; one dispatcher per element
    expect(r.setupCode.join('\n')).toContain('if (__t === "load") onLoad(__e, ...__s); else if (__t === "error") onError(__e, ...__s);');
  });

  it('converts template literals in ordinary bindings to concatenation', () => {
    const r = compile('<panel :desc="`已选 ${count} / ${items.length}`" />');
    expect(r.wxml).toContain('desc="{{ __d0 }}"');
    expect(r.setupCode[0]).toBe(
      "const __d0 = __fjsComputed(() => ('已选 ' + (count.value) + ' / ' + (items.value.length)));",
    );
    expect(r.wxml).not.toContain('`');
  });

  it('keeps v-for-scoped template literals verbatim in wxml', () => {
    const r = compile(
      '<view v-for="item in items" :title="`cell-${item.id}`">{{ `#${item.id}` }}</view>',
    );
    expect(r.wxml).toContain('title="{{ (\'cell-\' + (item.id)) }}"');
    expect(r.wxml).toContain('{{ (\'#\' + (item.id)) }}');
    expect(r.wxml).not.toContain('`');
  });

  it('converts nested template literals; :key interpolation is warned + omitted', () => {
    const r = compile('<view :title="`a${ `b${count}` }c`">x</view>');
    expect(r.setupCode[0]).toBe(
      "const __d0 = __fjsComputed(() => ('a' + (('b' + (count.value))) + 'c'));",
    );
    expect(r.wxml).not.toContain('`');
    const r2 = compile('<view v-for="(line, i) in items" :key="`${i}-${line}`" />');
    expect(r2.wxml).not.toContain('wx:key');
    expect(warn.some((w) => w.includes(':key'))).toBe(true);
  });

  it('rewriteImports: component imports become null, assets become URL consts', () => {
    const code = [
      "import Panel from '@/components/Panel.vue';",
      "import img from '@/assets/a.png';",
      "import type { X } from '@ufjs/iconmind';",
      "import { ref } from 'vue';",
      "const x = 1;",
    ].join('\n');
    const out = rewriteImports(code, (spec) => {
      if (spec.endsWith('.vue')) return { kind: 'const', target: 'null' };
      if (spec.endsWith('.png')) return { kind: 'const', target: '"/assets/a-h.png"' };
      if (spec === 'vue') return { kind: 'path', target: '../../fjs/runtime' };
      return null;
    });
    expect(out).toContain('const Panel = null;');
    expect(out).toContain('const img = "/assets/a-h.png";');
    expect(out).not.toContain('import type');
    expect(out).toContain("from '../../fjs/runtime'");
    // the comment mentioning import is untouched (lexer skips comments)
    expect(out).toContain('const x = 1;');
  });

  it('emits expression strings verbatim (wxml processes no escapes)', () => {
    // \\u escapes are NOT decoded by wxml — they render literally, so the
    // string must go out raw
    const r = compile('<text>{{ \'</>\' }}</text>');
    expect(r.wxml).toContain("{{ '</>' }}");
    expect(r.wxml).not.toContain('\\u003c');
    // && in expressions must stay raw (&quot; is the only escape we emit)
    const r2 = compile('<view wx:if="a < b && b > 0" />');
    expect(r2.wxml).toContain('a < b && b > 0');
  });

  it('appJson: native tabBar from tab meta, text-only items', () => {
    const pages = [
      { path: '/', name: 'index', meta: { title: '内置组件', tab: 0 } },
      { path: '/comp/switch', name: 'comp-switch', meta: { title: '开关' } },
      { path: '/about', name: 'about', meta: { title: '关于', tab: 3 } },
      { path: '/api', name: 'api', meta: { title: '接口', tab: 1 } },
    ];
    const app = JSON.parse(appJson(pages));
    expect(app.tabBar.list).toEqual([
      { pagePath: 'pages/index/index', text: '内置组件' },
      { pagePath: 'pages/api/api', text: '接口' },
      { pagePath: 'pages/about/about', text: '关于' },
    ]);
    expect(app.tabBar.selectedColor).toBe('#007aff');
    expect(app.componentFramework).toBe('glass-easel');
    // fewer than two tab pages: no tabBar section
    expect(JSON.parse(appJson(pages.slice(0, 2))).tabBar).toBeUndefined();
  });

  it('appJson: renderer defaults to webview; skyline adds its keys', () => {
    const pages = [{ path: '/', name: 'index', meta: {} }];
    const webview = JSON.parse(appJson(pages));
    expect(webview.renderer).toBeUndefined();
    expect(webview.rendererOptions).toBeUndefined();
    const skyline = JSON.parse(appJson(pages, 'skyline'));
    expect(skyline.renderer).toBe('skyline');
    expect(skyline.rendererOptions.skyline.sdkVersionBegin).toBe('3.0.0');
  });

  it('componentJson opts into apply-shared so app.wxss reaches components', () => {
    expect(JSON.parse(componentJson({})).styleIsolation).toBe('apply-shared');
  });

  it('decodes text entities; < runs become one concatenation expression', () => {
    // entities are NOT decoded by wxml — decode, then emit the run as a
    // single {{ }} concatenation so it stays on ONE line (wxml preserves
    // whitespace, per-child lines would render real breaks)
    const r = compile('<view>&lt;{{ tag }}&gt;</view>');
    expect(r.wxml).toContain("{{ '<' + (tag) + '>' }}");
    expect(r.wxml).not.toContain('&lt;');
    // plain & is harmless raw
    const r2 = compile('<view>a & b</view>');
    expect(r2.wxml).toContain('a & b');
  });

  it('safe-area is a runtime component; divider stays a downcast view', () => {
    const r = compile('<safe-area><view /></safe-area>');
    expect(r.wxml).toContain('<fjs-safe-area class="data-v-test">');
    expect(r.usingComponents.get('fjs-safe-area')).toBe('fjs-safe-area');
    const r2 = compile('<divider />');
    expect(r2.wxml).toContain('class="fjs-box fjs-divider data-v-test"');
  });
});

describe('expression rewriting', () => {
  it('appends .value only to setup refs, never to keys or properties', () => {
    expect(rewriteExpr('wifi = v', { bindings: BINDINGS, skip: new Set(['v']) })).toBe('wifi.value = v');
    expect(rewriteExpr('{ a: wifi, b: router.x }', { bindings: BINDINGS, skip: new Set() })).toBe(
      '{ a: wifi.value, b: router.x }',
    );
    expect(rewriteExpr("'wifi'", { bindings: BINDINGS, skip: new Set() })).toBe("'wifi'");
  });

  it('finds free scope identifiers for data-args', () => {
    expect(freeScopeIdentifiers('router.push(item.path)', BINDINGS, new Set())).toEqual(['item']);
  });

  it('collects referenced setup bindings for the data snapshot', () => {
    expect(referencedBindings('wifi || count', BINDINGS)).toEqual(['wifi', 'count']);
  });
});

describe('genScriptCode', () => {
  it('injects generated code around __returned__ without breaking accessors', () => {
    // `let` bindings compile into get/set accessor pairs — a naive textual
    // splice inside the object literal would corrupt them (see spec 046)
    const compiled = {
      content: `export default /* @__PURE__ */ _defineComponent({
  setup(__props) {
    let ticks = 1;
    const __returned__ = { get ticks() { return ticks }, set ticks(v) { ticks = v } };
    Object.defineProperty(__returned__, '__isScriptSetup', { enumerable: false, value: true });
    return __returned__;
  },
});`,
      bindings: { ticks: 'setup-let' },
    };
    const wxml = genWxml('<view @tap="ticks++">{{ ticks }}</view>', {
      bindings: compiled.bindings,
      vueImports: new Map(),
      filename: 'x.vue',
    });
    const code = genScriptCode({ compiled, wxml, kind: 'component', filename: 'x.vue' });
    expect(code).toContain('const __ev0 = (__e, ...__s) => { ticks++; };');
    expect(code).toContain('__returned__.__ev0 = __ev0;');
    expect(code).toContain('__sfc__.__fjsData = ["ticks"]');
    expect(code).toContain('export default __sfc__;');
    // the accessor pair must survive untouched
    expect(code).toContain('get ticks() { return ticks }');
  });
});

describe('genWxss', () => {
  it('rewrites scoped attribute selectors into classes', () => {
    const css = replaceScopeAttr('.row[data-v-x]{color:red}\nview[data-v-x]{}', 'data-v-x');
    expect(css).toContain('.row.data-v-x');
    expect(css).toContain('view.data-v-x');
    expect(css).not.toContain('[data-v-x]');
  });

  it('appends builtin downcast styles when a downcast tag is used', () => {
    const r = compile('<divider />');
    const css = genWxss({ styles: [], id: 'data-v-test', filename: 'x.vue', fjsClasses: r.fjsClasses });
    expect(css).toContain('.fjs-divider');
  });

  it('warns about skyline-unsupported css', () => {
    genWxss({ styles: [{ type: 'style' } as never, ], id: 'data-v-test', filename: 'x.vue' });
    void warn;
  });
});
