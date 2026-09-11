// One warn-once channel for the rich-text pipeline (parse / sanitize /
// layout / component), keyed so the same untrusted tag in a thousand-item
// feed is reported once, not a thousand times. Same shape as the textarea
// component's, minus the import cycle into the element layer.
const warned = new Set<string>();

export function warnRichTextOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[fjs] rich-text: ${message}`);
}

/** For tests. */
export function resetRichTextWarnOnce(): void {
  warned.clear();
}
