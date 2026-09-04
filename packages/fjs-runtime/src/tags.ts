import tags from './tags.json';
import componentTags from './component-tags.json';

/** Built-in tags implemented by the fjs runtime on Flutter and web.
 *
 * The list lives in tags.json so ../volar.cjs — CommonJS, because that is
 * how @vue/language-core loads plugins — can read the same one. */
export const FJS_TAGS: readonly string[] = tags;

/** Tags this runtime implements as JS COMPONENTS rather than element tags
 * (constitution VII). They are not in tags.json because they are not tags
 * the two hosts implement — but every place that decides "element or
 * component?" has to know them, and there are three: the bundler
 * (fjs/src/bundler/vue-plugin.ts), the runtime's HTML alias table
 * (vue/renderer.ts), and the Volar plugin (../volar.cjs, which is why this
 * is a JSON file and not a literal). Two of them — `form` and `textarea` —
 * are real HTML tag names, so a place that forgets this list types them
 * from the DOM and they silently stop working. */
export const FJS_COMPONENT_TAGS: readonly string[] = componentTags;
