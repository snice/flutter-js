// Ambient shape of the mini-program host for the wx runtime sources.
// Deliberately loose (`any` for the API surface): the real typings come from
// `miniprogram-api-typings` in the consuming project, and the runtime only
// touches a narrow, stable subset. Declared once here so every wx/*.ts file
// typechecks without per-file duplicates.
declare const wx: any;
declare function Component(options: any): void;
declare function App(options: any): void;
declare function Page(options: any): void;
declare function getCurrentPages(): any[];
declare function getApp(): any;
