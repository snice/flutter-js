// The node shapes `<rich-text :nodes>` accepts — the mini program's, kept
// verbatim so content prepared for WeChat can be handed over unchanged.

/** An element. `name` is case-insensitive; only trusted tags survive, and
 * only `class` / `style` plus the tag's own trusted attributes are kept. */
export interface RichTextElementNode {
  type?: 'node';
  name: string;
  attrs?: Record<string, string | number>;
  children?: RichTextNode[];
}

/** A run of text. HTML entities (`&nbsp;`, `&#x4e2d;`) are decoded. */
export interface RichTextTextNode {
  type: 'text';
  text: string;
}

export type RichTextNode = RichTextElementNode | RichTextTextNode;

/** How consecutive spaces are shown; unset collapses them as HTML does. */
export type RichTextSpace = 'ensp' | 'emsp' | 'nbsp';
