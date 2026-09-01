// iconmind — IconMind (https://iconmind.dev, MIT) as one fjs tag.
//
//   <icon-mind name="agent" :size="28" color="#5b4bde" />
//
// The icons themselves are data, and *which* data is decided by the app that
// installs this: prepare.mjs (the module's fjs.prepare hook) scans the app's
// sources for the names its templates write, and generates exactly those.
// The module only knows how to draw whatever it generated, so an app never
// carries icons nothing shows — and never configures anything either.
//
// The tag is the same on both targets, the painting is not — Dart paints the
// shapes onto a CustomPaint, the browser renders them as inline SVG — but the
// geometry and the two duotone rules come from that one file, so the two
// agree by construction.
//
// Names are the slugs on https://iconmind.dev/icons ('agent',
// 'vector-database', 'firewall', …). A slug is a plain string here rather
// than a union, because the union belongs to the app that chose the list; a
// name that is not in the data draws nothing and says so in the console, the
// way a missing image does.

declare global {
  /** The icons an app ships, as a type.
   *
   * The module cannot know them — the app picks the list and generates the
   * data from it — so this interface is the seam: the generator augments it
   * with one key per configured slug, and `name` completes and typechecks
   * against exactly what the app carries. An app that generates nothing
   * leaves it empty, and [IconName] falls back to `string`.
   *
   * Same registry trick as FjsRoutes in the runtime's router types: a global
   * interface, so it works through the module's bare specifier without the
   * app having to augment a module declaration. */
  interface FjsIcons {}
}

/** A slug the app ships (see [FjsIcons]), or any string when it ships no
 * generated list. */
export type IconName = keyof FjsIcons extends never ? string : keyof FjsIcons & string;

/** `outline` is the plain drawing; `duotone` adds the 20% tint layer. */
export type IconVariant = 'outline' | 'duotone';

/** Each weight is its own stroke width on the same geometry. */
export type IconWeight = 'thin' | 'regular' | 'bold';

/** Stroke width per weight — the three IconMind draws with, shared by both
 * painters so a `bold` icon is the same weight on a phone and in a tab. */
export const STROKE: Record<IconWeight, number> = {
  thin: 1.25,
  regular: 1.75,
  bold: 2.5,
};
