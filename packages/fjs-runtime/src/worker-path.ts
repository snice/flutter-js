// The one shape `new Worker` accepts on every target (specs/049): a root
// path under /workers ending in .js — src/workers/<rel>.ts|js as the fjs
// build emits it. Its own module so the mini-program runtime can share the
// check without pulling in the host bridge.
const WORKER_PATH = /^\/workers\/[^?#]+\.js$/;

/** Throws unless `path` is a worker file path. */
export function checkWorkerPath(path: unknown): string {
  if (typeof path === 'string' && WORKER_PATH.test(path)) return path;
  const shown = typeof path === 'string' ? JSON.stringify(path.length > 60 ? path.slice(0, 60) + '…' : path) : String(path);
  throw new Error(
    `[fjs] new Worker(${shown}): Worker takes a worker file path — put the code in src/workers/<name>.ts ` +
      `and call new Worker('/workers/<name>.js'). Code strings are no longer accepted (specs/049).`,
  );
}

