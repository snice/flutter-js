// Vue Language Tools (Volar) plugin — IDE half of the tag handling that
// packages/fjs/src/vue-plugin.ts does for the build.
//
// Without it, `text`, `image`, `button`, `input`, `switch` and `progress`
// are parsed as native HTML/SVG elements, so the editor types them from
// @vue/runtime-dom's IntrinsicElementAttributes and never looks at the
// GlobalComponents augmentation in src/vue-global.d.ts — no attribute
// completion, no go-to-definition, and bogus DOM event signatures.
//
// Enable it from a project's tsconfig.json:
//   "vueCompilerOptions": { "plugins": ["@ufjs/runtime/volar"] }
//
// CommonJS on purpose: @vue/language-core loads plugins with require().
const { isHTMLTag, isSVGTag, isMathMLTag } = require('@vue/shared');

const FJS_TAGS = new Set(require('./src/tags.json'));

/** @type {import('@vue/language-core').VueLanguagePlugin} */
const plugin = () => ({
  version: 2.2,
  name: 'fjs-tags',
  resolveTemplateCompilerOptions(options) {
    return {
      ...options,
      isNativeTag: (tag) =>
        !FJS_TAGS.has(tag) && (isHTMLTag(tag) || isSVGTag(tag) || isMathMLTag(tag)),
    };
  },
});

module.exports = plugin;
