// Editor/typecheck entry for 'fjs/router'. Builds alias this specifier to
// router/flutter.ts or router/web.ts; both export the same surface, and
// the Flutter one is the reference implementation.
export * from './flutter';
export { Matcher, parseQuery, stringifyQuery } from './match';
