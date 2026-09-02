// @vitest-environment happy-dom
// Which transition a navigation runs under: the app-level option, a page's
// own `meta.transition`, and the tab switch that has none on either
// platform. The name is observable as the leaving page's CSS classes.
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { createFjsApp, type FjsAppOptions } from '../src/app/web';
import { resolveTransition } from '../src/router/transition';
import type { RouteLocation } from '../src/router/types';

const page = (name: string) =>
  defineComponent({ name, setup: () => () => h('view', { class: name }) });

const routes = [
  { path: '/', meta: { tab: 0 }, component: page('home') },
  { path: '/api', meta: { tab: 1 }, component: page('api') },
  { path: '/detail', component: page('detail') },
  { path: '/quiet', meta: { transition: false as const }, component: page('quiet') },
];

async function mountApp(options: Partial<FjsAppOptions> = {}) {
  const app = createFjsApp({ routes, el: '#app', ...options });
  app.mount();
  await (
    app.router as unknown as { vueRouter: { isReady: () => Promise<void> } }
  ).vueRouter.isReady();
  await nextTick();
  return app;
}

function host(): HTMLElement {
  const el = document.querySelector('fjs-page-host');
  if (!el) throw new Error('missing fjs-page-host');
  return el as HTMLElement;
}

/** Runs router.back() and resolves once the navigation has been applied. */
async function popped(app: { router: unknown }): Promise<void> {
  const vueRouter = (app.router as { vueRouter: { afterEach: (fn: () => void) => () => void } })
    .vueRouter;
  const done = new Promise<void>((resolve) => {
    const off = vueRouter.afterEach(() => {
      off();
      resolve();
    });
  });
  (app.router as { back: () => void }).back();
  await done;
  await nextTick();
}

/** The page that is leaving, mid-navigation. */
function leaving(): HTMLElement {
  const entries = [...document.querySelectorAll<HTMLElement>('fjs-page-entry')];
  const el = entries.find((e) => e.className.includes('-leave-active'));
  if (!el) throw new Error('no page is leaving');
  return el;
}

/** The page that is arriving, mid-navigation. */
function entering(): HTMLElement {
  const entries = [...document.querySelectorAll<HTMLElement>('fjs-page-entry')];
  const el = entries.find((e) => e.className.includes('-enter-active'));
  if (!el) throw new Error('no page is entering');
  return el;
}

/** The transition classes on the page that is leaving, mid-navigation. */
function leavingClasses(): string {
  const entries = [...document.querySelectorAll('fjs-page-entry')];
  return entries.map((el) => el.className).find((name) => name.length > 0) ?? '';
}

async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 300));
}

const location = (path: string, meta: Record<string, unknown> = {}): RouteLocation => ({
  path,
  fullPath: path,
  params: {},
  query: {},
  meta,
});

describe('web page transition', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.getElementById('app')?.remove();
    history.replaceState(null, '', '#/');
  });

  it('animates a push but not a tab switch', async () => {
    const app = await mountApp();

    await app.router.push('/detail');
    await nextTick();
    expect(leavingClasses()).toContain('fjs-page-leave-active');
    await settle();

    app.router.back();
    await settle();

    await app.router.replace('/api');
    await nextTick();
    expect(leavingClasses()).toContain('fjs-page-none-leave-active');
    // the CSS also cancels the animation through the host, which is what
    // catches a page coming back out of the KeepAlive cache with the
    // previous navigation's class names on it
    expect(host().dataset.nav).toBe('none');
  });

  it('mirrors the animation on the way back', async () => {
    const app = await mountApp();

    await app.router.push('/detail');
    await settle();
    expect(host().dataset.nav).toBe('push');

    await popped(app);
    // the popped page is still on screen playing its leave — dropping it
    // from KeepAlive right away would cut the animation off at frame one
    expect(leavingClasses()).toContain('fjs-page-leave-active');
    expect(document.querySelector('.detail')).toBeTruthy();
    // ...and the host says which way it runs, which is what the CSS
    // mirrors. A name would not do: the page we are going back to was
    // cached with the hooks of the push that left it.
    expect(host().dataset.nav).toBe('pop');

    await settle();
    expect(document.querySelector('.detail')).toBeNull();
    expect(document.querySelectorAll('fjs-page-entry').length).toBe(1);
  });

  it('lets one page opt out with meta.transition', async () => {
    const app = await mountApp();

    await app.router.push('/quiet');
    await nextTick();
    expect(leavingClasses()).toContain('fjs-page-none-leave-active');
  });

  it('animates the arriving page too, on top of the one leaving', async () => {
    const app = await mountApp({ transition: 'fjs-slide' });

    await app.router.push('/detail');
    await nextTick();
    // the page arriving has to run its own half of the animation: with the
    // KeepAlive slot passed as a slot object instead of children, Vue hands
    // the enter hooks to the outgoing subtree and the new page just
    // appeared while the old one slid away — a push that read backwards
    expect(entering().className).toContain('fjs-slide-enter-active');
    // ...and it is the one on top; the page sliding away goes under it
    expect(getComputedStyle(leaving()).zIndex).toBe('0');
    expect(getComputedStyle(leaving()).position).toBe('absolute');
    expect(getComputedStyle(entering()).zIndex).toBe('1');
    await settle();

    await popped(app);
    // going back it is the other way round: the top page slides off
    expect(getComputedStyle(leaving()).zIndex).toBe('1');
    expect(getComputedStyle(entering()).zIndex).toBe('0');
  });

  it('runs one of the shipped families by name', async () => {
    const app = await mountApp({ transition: 'fjs-slide-up' });

    await app.router.push('/detail');
    await nextTick();
    expect(leavingClasses()).toContain('fjs-slide-up-leave-active');
  });

  it('lets the app decide per navigation', async () => {
    const app = await mountApp({
      transition: (nav) => (nav.kind === 'push' ? 'zoom' : false),
    });

    await app.router.push('/detail');
    await nextTick();
    expect(leavingClasses()).toContain('zoom-leave-active');
  });

  it('turns every animation off with transition: false', async () => {
    const app = await mountApp({ transition: false });

    await app.router.push('/detail');
    await nextTick();
    // no <Transition> at all: the leaving page is simply gone
    expect(leavingClasses()).toBe('');
  });
});

describe('transition policy', () => {
  const push = (to: RouteLocation, from = location('/')) =>
    ({ to, from, kind: 'push' }) as const;

  it('defaults to the slide-in, and to none for tabs and the first page', () => {
    expect(resolveTransition(undefined, push(location('/detail')))).toBe('fjs-page');
    // a pop runs the same family — the direction is the host's data-nav
    expect(
      resolveTransition(undefined, {
        to: location('/'),
        from: location('/detail'),
        kind: 'pop',
      }),
    ).toBe('fjs-page');
    expect(
      resolveTransition(undefined, {
        to: location('/api', { tab: 1 }),
        from: location('/', { tab: 0 }),
        kind: 'tab',
      }),
    ).toBe(false);
    expect(
      resolveTransition(undefined, {
        to: location('/'),
        from: location('/'),
        kind: 'initial',
      }),
    ).toBe(false);
  });

  it('asks the page that moves — the popped one on the way back', () => {
    const quiet = location('/quiet', { transition: false });
    expect(resolveTransition(undefined, push(quiet))).toBe(false);
    expect(
      resolveTransition(undefined, { to: location('/'), from: quiet, kind: 'pop' }),
    ).toBe(false);
    // the page being *left* on a push has no say
    expect(resolveTransition(undefined, push(location('/detail'), quiet))).toBe('fjs-page');
  });

  it('lets the app-level option win over a page', () => {
    const quiet = location('/quiet', { transition: false });
    expect(resolveTransition(() => 'zoom', push(quiet))).toBe('zoom');
    expect(resolveTransition(false, push(location('/detail')))).toBe(false);
  });
});
