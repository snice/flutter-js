import tags from './tags.json';

/** Built-in tags implemented by the fjs runtime on Flutter and web.
 *
 * The list lives in tags.json so ../volar.cjs — CommonJS, because that is
 * how @vue/language-core loads plugins — can read the same one. */
export const FJS_TAGS: readonly string[] = tags;
