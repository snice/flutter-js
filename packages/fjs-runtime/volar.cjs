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
//
// The tag lists are read ONCE, when the editor loads this plugin. So after
// adding a tag to src/tags.json or src/component-tags.json, a running TS
// server still has the old set
// and types the new tag from the DOM instead — `<form>` shows up as
// FormHTMLAttributes and its props look wrong. Restart the TS server
// ("TypeScript: Restart TS Server" / reload the window); `vue-tsc` on the
// command line is unaffected because it starts fresh.
const { isHTMLTag, isSVGTag, isMathMLTag } = require('@vue/shared');

const FJS_TAGS = new Set(require('./src/tags.json'));
// Tags implemented as JS components. They are not in tags.json (they are not
// host tags), but `form` and `textarea` are real HTML tag names, so without
// this set vue-tsc types them from @vue/runtime-dom and every fjs-only prop
// is an error. Same list the bundler uses.
const FJS_COMPONENT_TAGS = new Set(require('./src/component-tags.json'));

/** @type {import('@vue/language-core').VueLanguagePlugin} */
const plugin = () => ({
  version: 2.2,
  name: 'fjs-tags',
  resolveTemplateCompilerOptions(options) {
    return {
      ...options,
      isNativeTag: (tag) =>
        !FJS_COMPONENT_TAGS.has(tag) &&
        !FJS_TAGS.has(tag) &&
        (isHTMLTag(tag) || isSVGTag(tag) || isMathMLTag(tag)),
    };
  },
});

module.exports = plugin;
