// The fetch globals the runtime installs on the native host (net/fetch.ts).
//
// Their *types* need no declaration: projects target ES2021 without a `lib`
// override, and TypeScript's default lib for that already declares fetch,
// Headers, Response and AbortController. What it does not know about is the
// one extension this runtime adds, so that goes here — declared as a plain
// interface merge, which also stands on its own if a project ever drops the
// DOM lib.
//
// A script, not a module, so this merges into the global scope; see the note
// in native-global.d.ts.
//
// Reminder for what those inherited types promise but this runtime does not
// implement: bodies never stream (`res.body` is absent — the response
// arrives whole), and `blob()` / `formData()` are not implemented.

interface RequestInit {
  /** fjs extension: fail the request after this many milliseconds. Not in
   * the standard, which spells this as an AbortSignal. */
  timeout?: number;
}
