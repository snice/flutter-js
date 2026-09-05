// measureText: a synchronous host call, with a cache that is not optional.
//
// The host measures with the same TextPainter it lays text out with, which
// is the only way the metric a page gets back matches what it will see
// drawn. That call is a full FFI round trip plus a paragraph layout, and it
// sits on the hot path: a chart's layout pass measures every axis label,
// every legend entry and every tooltip candidate, most of them repeatedly
// and most of them unchanged between frames. Without the cache, measuring
// costs more than drawing.
import { invokeHost } from '../host';
import { fontJson, type FjsCanvasFont } from './font';
import type { FjsCanvasTextMetrics } from './types';

/** What the DOM's TextMetrics gives, minus the fields the host cannot
 * produce. Absent fields stay absent rather than being faked: a library that
 * feature-detects them (ECharts does) should take its own fallback path
 * instead of trusting a zero. */
export type FjsTextMetrics = FjsCanvasTextMetrics;

/** Entries kept. Bounded because a page that measures unique strings forever
 * (a clock, a counter) must not grow the heap forever. */
const CACHE_MAX = 2048;
const cache = new Map<string, FjsTextMetrics>();

export function measureTextOnHost(
  font: FjsCanvasFont,
  text: string,
): FjsTextMetrics {
  const json = fontJson(font);
  const key = `${json} ${text}`;
  const hit = cache.get(key);
  if (hit !== undefined) {
    // refresh recency: Map preserves insertion order, so re-inserting moves
    // the entry to the end and makes the first key the least recently used
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  let metrics: FjsTextMetrics = { width: 0 };
  try {
    const raw = invokeHost<string>('fjs.canvas.measureText', json, text);
    if (typeof raw === 'string' && raw !== '') {
      metrics = JSON.parse(raw) as FjsTextMetrics;
    }
  } catch {
    // No host (a unit test, or the web build reaching this by mistake). A
    // zero width is wrong but bounded; throwing here would take down a
    // page's whole layout pass.
    metrics = { width: 0 };
  }
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, metrics);
  return metrics;
}

/** Test hook. */
export function clearMeasureCache(): void {
  cache.clear();
}
