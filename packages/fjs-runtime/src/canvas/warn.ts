// One warn-once channel for the whole canvas layer. Unsupported API has to
// say so — a method that silently does nothing is the failure constitution V
// is about, and on canvas it is especially opaque: the page just gets an
// empty region with no clue which call was dropped.
const warned = new Set<string>();

export function warnCanvasOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[fjs] ${message}`);
}

/** Test hook: forget what has been warned about. */
export function resetCanvasWarnings(): void {
  warned.clear();
}
