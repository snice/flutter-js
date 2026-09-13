// SFC script -> mini-program page/component module. compileScript's output
// (a defineComponent options object with a setup that returns __returned__)
// is post-processed in place: the compiler-generated handlers and computeds
// from wxml.ts are injected into the setup scope, added to __returned__, and
// the module ends with a createWevuComponent() registration call. The `vue`
// specifier resolves to @ufjs/runtime/wx (the reactivity shim), so no vdom
// runtime ever enters the bundle.
import type { WxmlResult } from './wxml.js';

export interface ScriptGenOptions {
  /** compileScript result. */
  compiled: { content: string; bindings: Record<string, string> };
  wxml: WxmlResult;
  kind: 'page' | 'component';
  filename: string;
  /** page only: the compile-time route. The SFC itself is the
   * Component()-constructed page (isPage) and exposes `route` to its
   * template (the shell prop), synced with onLoad query. */
  route?: { path: string; name: string; meta: Record<string, unknown> };
}

const RUNTIME_IMPORT =
  "import { createWevuComponent as __fjsCreate } from '@ufjs/runtime/wx';";
const HELPER_IMPORT =
  "import { computed as __fjsComputed, stringifyClass as __fjsStringifyClass, stringifyStyle as __fjsStringifyStyle } from '@ufjs/runtime/wx';";
const PAGE_IMPORT =
  "import { reactive as __fjsReactive, onLoad as __fjsOnLoad, setActiveRoute as __fjsSetPageRoute } from '@ufjs/runtime/wx';";

export function genScriptCode(options: ScriptGenOptions): string {
  const { compiled, wxml } = options;
  let code = compiled.content;

  // `export default <obj>` -> `const __sfc__ = <obj>` (the registration call
  // below replaces the default export's job)
  if (code.includes('export default')) {
    code = code.replace(/export default/, 'const __sfc__ =');
  } else {
    code = `const __sfc__ = {};\n${code}`;
  }

  // page flavor: inject the route location into the setup scope — the same
  // plain-object shape the other routers expose; query lands at onLoad
  // (before first render) and activeRoute keeps useRouter() honest
  const extraSetup: string[] = [];
  const extraNames: string[] = [];
  const extraImports: string[] = [];
  if (options.kind === 'page' && options.route) {
    const { path, name, meta } = options.route;
    const routeLit = JSON.stringify({ path, name, meta, fullPath: path });
    extraSetup.push(
      `const route = __fjsReactive({ ...${routeLit}, params: {}, query: {} });`,
      `__fjsOnLoad((query) => {`,
      `  const entries = Object.entries(query ?? {});`,
      `  for (const [k, v] of entries) route.query[k] = v;`,
      `  route.fullPath = entries.length ? '${path}?' + entries.map(([k, v]) => k + '=' + encodeURIComponent(String(v))).join('&') : '${path}';`,
      `  __fjsSetPageRoute(route);`,
      `});`,
    );
    extraNames.push('route');
    extraImports.push(PAGE_IMPORT);
  }

  // inject generated handlers/computeds into the setup scope, then attach
  // them to __returned__ before it escapes. Textually extending the object
  // literal is NOT safe: `let` bindings compile into get/set accessor pairs
  // whose braces would swallow a naive splice.
  const setupCode = [...extraSetup, ...wxml.setupCode];
  const returnedNames = [...extraNames, ...wxml.returnedNames];
  const dataNames = [...extraNames, ...wxml.dataNames];
  if (setupCode.length) {
    const decl = /(\s*)const __returned__ = \{/.exec(code);
    if (!decl) {
      throw new Error(
        `${options.filename}: compileScript produced no __returned__ — script-setup templates only`,
      );
    }
    const pad = decl[1];
    const generated = setupCode.map((l) => `${pad}  ${l}`).join('\n');
    const assignments = returnedNames.map((n) => `${pad}__returned__.${n} = ${n};`).join('\n');
    code = code.slice(0, decl.index) + `${generated}\n` + code.slice(decl.index);
    const defineRe = /(\s*)(Object\.defineProperty\(__returned__|return __returned__)/;
    const dm = defineRe.exec(code);
    if (!dm) {
      throw new Error(`${options.filename}: cannot find __returned__ handoff in compileScript output`);
    }
    code = code.slice(0, dm.index) + `${assignments}\n` + code.slice(dm.index);
  }

  // the runtime narrows setData to exactly the bindings the template reads —
  // keeps event-handler-only bindings (a router object, say) out of data
  code += `\n__sfc__.__fjsData = ${JSON.stringify(dataNames)};`;
  code += `\n${HELPER_IMPORT}`;
  for (const extra of extraImports) code += `\n${extra}`;
  code += `\n${RUNTIME_IMPORT}`;
  code += `\n__fjsCreate(__sfc__, { isPage: ${options.kind === 'page'} });`;
  // importing SFCs still `import X from './X.vue'` for usingComponents book
  // keeping — the default export keeps the emission honest even though tag
  // resolution itself goes through the component's JSON path
  code += `\nexport default __sfc__;`;
  return code;
}
