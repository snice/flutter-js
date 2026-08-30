// Shared router types. The same surface is implemented twice: once on top
// of the native Flutter Navigator (router/flutter.ts) and once on top of
// vue-router (router/web.ts). App code imports 'fjs/router' and the build
// aliases it to the right one, so a page never knows which platform it is
// running on.
import type { Component } from '@vue/runtime-core';

export interface RouteMeta {
  /** Title shown by the app shell / navigation bar. */
  title?: string;
  /** Root-level page reachable from a tab bar (no back button). */
  tab?: number;
  [key: string]: unknown;
}

/** One entry of the generated route table (see `fjs/pages`). */
export interface RouteRecord {
  path: string;
  name?: string;
  meta?: RouteMeta;
  /** Web builds: the page component (sync or `() => import(...)`). */
  component?: Component | (() => Promise<unknown>);
  /** Flutter builds: id of the page chunk to evaluate before mounting. */
  chunk?: string;
}

export interface RouteLocation {
  path: string;
  /** path + query string, the identity used for history entries. */
  fullPath: string;
  name?: string;
  params: Record<string, string>;
  query: Record<string, string>;
  meta: RouteMeta;
}

export type RouteLocationRaw =
  | string
  | {
      path?: string;
      name?: string;
      params?: Record<string, string | number>;
      query?: Record<string, string | number | undefined | null>;
    };

export interface Router {
  /** The active route. Reactive; also injected per page (see useRoute). */
  readonly currentRoute: RouteLocation;
  readonly routes: RouteRecord[];
  /** Pushes a new page. Flutter: a native Navigator push (animated, with
   * the platform's back gesture). Web: router.push. */
  push(to: RouteLocationRaw): Promise<void>;
  /** Replaces the current page in place (what a tab switch wants). */
  replace(to: RouteLocationRaw): Promise<void>;
  back(): void;
  /** Only negative deltas are supported on Flutter (no forward stack). */
  go(delta: number): void;
  resolve(to: RouteLocationRaw): RouteLocation;
}

export interface RouterOptions {
  routes: RouteRecord[];
  /** Wraps every page: gets a `route` prop and the page in its default
   * slot. Usually the app shell (navigation bar + tab bar). */
  shell?: Component;
  /** Where to start. Default '/'. */
  initial?: string;
}
