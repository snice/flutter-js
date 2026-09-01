// Loads the `fjs add` registry from packages.json.
//
// The data is JSON rather than TypeScript so that adding a library is a
// data change, not a code change — and so a project-local registry can be
// merged in later without touching this file.
import data from './packages.json';
import type { Platform } from '../project/pages.js';

export type Kind = 'dep' | 'plugin';

export interface Recipe {
  name: string;
  kind: Kind;
  description: string;
  /** Runtime dependencies written into package.json. */
  deps?: Record<string, string>;
  devDeps?: Record<string, string>;
  /** Bare specifiers appended to `fjs.shared` — see sharedBare(). */
  shared?: string[];
  /** kind 'plugin': the file written to src/plugins/. */
  plugin?: { file: string; source: string };
  /** Native capabilities this needs: `fjs native add <cap>`. */
  requires?: string[];
  /** Targets the library works on. Omitted means both. */
  targets?: Platform[];
  notes?: string[];
}

interface RawRecipe extends Omit<Recipe, 'plugin'> {
  plugin?: { file: string; source: string[] };
}

// TypeScript infers a union of literal shapes from the JSON, one per
// entry; the schema this file declares is the contract instead.
const entries = data.packages as unknown as RawRecipe[];

export const RECIPES: Recipe[] = entries.map((raw) => ({
  ...raw,
  plugin: raw.plugin
    ? { file: raw.plugin.file, source: `${raw.plugin.source.join('\n')}\n` }
    : undefined,
}));

export function findRecipe(name: string): Recipe {
  const recipe = RECIPES.find((r) => r.name === name);
  if (recipe) return recipe;
  throw new Error(
    `fjs add does not know "${name}". Known: ${RECIPES.map((r) => r.name).join(', ')}\n` +
      `Anything else is a plain dependency — install it with your package manager.`,
  );
}
