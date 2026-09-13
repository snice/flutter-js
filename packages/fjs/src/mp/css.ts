import { warn } from '../terminal/colors.js';
// SFC <style> blocks -> WXSS. WXSS is real CSS, so blocks pass through
// compileStyle (scoped rewriting, ::v-deep, v-bind()) and then get one mp
// specific fix: the scoped attribute selector becomes a class, because
// skyline does not match attribute selectors and we stamp the scope id as a
// class on every element in the template instead.
import { compileStyle, type SFCStyleBlock } from '@vue/compiler-sfc';

/** Styles for the downcast tags' builtin classes (see wxml.ts TAG_DOWNCAST).
 * Values match the web adapter's base-css.ts — the two ends take the same
 * numbers, per the constitution's WeUI/两端同源 rule. */
export const FJS_CLASS_CSS: Record<string, string> = {
  'fjs-safe-area': `
.fjs-safe-area {
  display: flex;
  flex-direction: column;
  flex-grow: 1;
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
  padding-left: env(safe-area-inset-left, 0px);
  padding-right: env(safe-area-inset-right, 0px);
}`,
  'fjs-divider': `
.fjs-divider {
  display: block;
  height: 16px;
  border: 0;
  background: linear-gradient(currentColor, currentColor) center / 100% 1px no-repeat;
  color: #e0e0e0;
}`,
  'fjs-stack': `
.fjs-stack {
  position: relative;
  display: grid;
  grid-template-rows: 1fr;
  grid-template-columns: 1fr;
}
.fjs-stack > view {
  grid-row: 1;
  grid-column: 1;
}`,
  'fjs-position': `
.fjs-position {
  position: relative;
}`,
  // content wrapper for a <slot> that is a direct child of scroll-view
  // type=list (skyline's list container needs element children)
  'fjs-scroll-inner': `
.fjs-scroll-inner {
  display: flex;
  flex-direction: column;
}`,
};

const WARN_PATTERNS: Array<[RegExp, string]> = [
  [/position\s*:\s*fixed/, 'position: fixed is restricted under skyline'],
];

/** Pseudo-classes skyline rejects outright ("Invalid Selectors" warnings in
 * DevTools). Rules carrying them are STRIPPED from the output — keeping them
 * only pollutes the console, the engine ignores them either way. Press
 * states belong in hover-class on the mp target (known divergence). */
const STRIP_PSEUDO = /:(active|hover|focus|focus-within|visited)\b/;

export function stripUnsupportedPseudo(css: string, filename: string): string {
  return css.replace(/([^{}]+)\{([^{}]*)\}/g, (rule, selector: string, body: string) => {
    if (!STRIP_PSEUDO.test(selector)) return rule;
    warn(
      `[fjs/mp] ${filename}: dropped "${selector.trim()}" — pseudo-classes are not supported by skyline`,
    );
    void body;
    return '';
  });
}

export interface StyleGenOptions {
  styles: SFCStyleBlock[];
  /** scope id ('data-v-xxxxxxxx') — same value compileStyle was given. */
  id: string;
  filename: string;
  fjsClasses?: string[];
}

export function genWxss(options: StyleGenOptions): string {
  const { styles, id, filename } = options;
  const chunks: string[] = [];
  for (const s of styles) {
    if (s.lang && s.lang !== 'css' && s.lang !== 'postcss') {
      warn(`[fjs/mp] ${filename}: <style lang="${s.lang}"> needs a preprocessor — skipped`);
      continue;
    }
    const compiled = compileStyle({
      source: s.content,
      filename,
      id,
      scoped: s.scoped === true,
    });
    if (compiled.errors.length) {
      for (const e of compiled.errors) warn(`[fjs/mp] ${filename}: ${String(e)}`);
      continue;
    }
    chunks.push(replaceScopeAttr(compiled.code, id));
  }
  for (const cls of options.fjsClasses ?? []) {
    const css = FJS_CLASS_CSS[cls];
    if (css) chunks.push(css);
  }
  let out = chunks.join('\n\n');
  out = stripUnsupportedPseudo(out, filename);
  warnUnsupported(out, filename);
  return out + (out.trim() ? '\n' : '');
}

/** `[data-v-x]` selectors -> `.data-v-x` (the template stamps that class).
 * `id` already carries the data-v- prefix, matching compileStyle's output. */
export function replaceScopeAttr(css: string, id: string): string {
  return css.split(`[${id}]`).join(`.${id}`);
}

function warnUnsupported(css: string, filename: string): void {
  for (const [re, msg] of WARN_PATTERNS) {
    if (re.test(css)) warn(`[fjs/mp] ${filename}: ${msg}`);
  }
}
