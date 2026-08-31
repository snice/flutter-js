// @vitest-environment happy-dom
// params / query shape, and the one place where the two platforms have to
// agree by hand: the catch-all segment.
import { describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import { Matcher } from '../src/router/match';
import { createRouter } from '../src/router/web';
import type { RouteRecord } from '../src/router/types';

const Page = defineComponent({ render: () => null });

const table: RouteRecord[] = [
  { path: '/', name: 'index', component: Page },
  { path: '/user/:id', name: 'user-id', component: Page },
  { path: '/*', name: 'all', component: Page },
];

describe('app matcher', () => {
  const matcher = new Matcher(table);

  it('decodes params and query as strings', () => {
    const route = matcher.resolve('/user/7?tab=orders&flag');
    expect(route.params).toEqual({ id: '7' });
    expect(route.query).toEqual({ tab: 'orders', flag: '' });
    expect(route.fullPath).toBe('/user/7?tab=orders&flag=');
  });

  it('fills params when pushing by name', () => {
    expect(matcher.resolve({ name: 'user-id', params: { id: 7 } }).path).toBe('/user/7');
  });

  it('puts the catch-all rest in params.pathMatch', () => {
    const route = matcher.resolve('/nope/deep');
    expect(route.name).toBe('all');
    expect(route.params.pathMatch).toBe('nope/deep');
  });
});

describe('web router', () => {
  const router = createRouter({ routes: table });

  it('matches the same params', () => {
    const route = router.vueRouter.resolve('/user/7?tab=orders');
    expect(route.params).toEqual({ id: '7' });
    expect(route.query).toEqual({ tab: 'orders' });
  });

  // the app's `/*` is not vue-router syntax: untranslated it matches the
  // literal path "/*" and every unknown address falls through to the redirect
  it('renders the catch-all page with a string pathMatch', () => {
    const route = router.vueRouter.resolve('/nope/deep');
    expect(route.name).toBe('all');
    expect(route.params.pathMatch).toBe('nope/deep');
    expect(route.redirectedFrom).toBeUndefined();
  });
});
