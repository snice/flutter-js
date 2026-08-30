// Path matching and location normalization — the part of the router that
// is identical on both platforms. Supports static segments, `:param` and a
// trailing `*` catch-all, which is the subset vue-router and the generated
// file-based table actually use.
import type { RouteLocation, RouteLocationRaw, RouteMeta, RouteRecord } from './types';

interface CompiledRoute {
  record: RouteRecord;
  re: RegExp;
  keys: string[];
  /** Static routes win over dynamic ones regardless of table order. */
  score: number;
}

function compile(record: RouteRecord): CompiledRoute {
  const keys: string[] = [];
  let score = 0;
  const segments = record.path.split('/').filter(Boolean);
  let source = '^';
  for (const seg of segments) {
    if (seg === '*') {
      keys.push('pathMatch');
      source += '/(.*)';
      score -= 10;
    } else if (seg.startsWith(':')) {
      keys.push(seg.slice(1));
      source += '/([^/]+)';
      score += 1;
    } else {
      source += '/' + seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      score += 10;
    }
  }
  source += '/?$';
  return { record, re: new RegExp(source), keys, score };
}

export function parseQuery(search: string): Record<string, string> {
  const query: Record<string, string> = {};
  for (const part of search.replace(/^\?/, '').split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const key = eq < 0 ? part : part.slice(0, eq);
    const value = eq < 0 ? '' : part.slice(eq + 1);
    query[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, ' '));
  }
  return query;
}

export function stringifyQuery(query: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length ? '?' + parts.join('&') : '';
}

/** Fills `:param` placeholders from `params` (router.push({ name, params })). */
function fillParams(path: string, params: Record<string, string | number>): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, (whole, key: string) =>
    key in params ? encodeURIComponent(String(params[key])) : whole,
  );
}

export class Matcher {
  private compiled: CompiledRoute[];

  constructor(readonly routes: RouteRecord[]) {
    this.compiled = routes.map(compile).sort((a, b) => b.score - a.score);
  }

  record(path: string): RouteRecord | null {
    return this.match(path)?.record ?? null;
  }

  private match(path: string): { record: RouteRecord; params: Record<string, string> } | null {
    for (const route of this.compiled) {
      const m = route.re.exec(path === '' ? '/' : path);
      if (!m) continue;
      const params: Record<string, string> = {};
      route.keys.forEach((key, i) => {
        params[key] = decodeURIComponent(m[i + 1] ?? '');
      });
      return { record: route.record, params };
    }
    return null;
  }

  /** Normalizes any `push()` argument into a full location. Unknown paths
   * still resolve (with empty meta) so the caller can decide what to do —
   * a page missing on this platform is a routing decision, not a crash. */
  resolve(to: RouteLocationRaw): RouteLocation {
    let path: string;
    let query: Record<string, string> = {};
    if (typeof to === 'string') {
      const q = to.indexOf('?');
      path = q < 0 ? to : to.slice(0, q);
      if (q >= 0) query = parseQuery(to.slice(q));
    } else {
      const named = to.name
        ? this.routes.find((r) => r.name === to.name)?.path
        : undefined;
      path = fillParams(named ?? to.path ?? '/', to.params ?? {});
      for (const [key, value] of Object.entries(to.query ?? {})) {
        if (value !== undefined && value !== null) query[key] = String(value);
      }
    }
    if (!path.startsWith('/')) path = '/' + path;
    const hit = this.match(path);
    const meta: RouteMeta = { ...(hit?.record.meta ?? {}) };
    return {
      path,
      fullPath: path + stringifyQuery(query),
      name: hit?.record.name,
      params: { ...(hit?.params ?? {}), ...(typeof to === 'object' ? mapParams(to.params) : {}) },
      query,
      meta,
    };
  }
}

function mapParams(params?: Record<string, string | number>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params ?? {})) out[key] = String(value);
  return out;
}
