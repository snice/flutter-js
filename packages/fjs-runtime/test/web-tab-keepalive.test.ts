// @vitest-environment happy-dom
// Tab pages (meta.tab) keep their state and scroll across a tab switch —
// `router.replace` between two of them parks the leaving page instead of
// destroying it. Leaving the tab group drops the parked pages.
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { createFjsApp } from '../src/app/web';

function shellBody(): HTMLElement {
  const el = document.querySelector('scroll-view.body');
  if (!el) throw new Error('missing scroll-view.body');
  return el as HTMLElement;
}

function count(): string | undefined {
  return document.querySelector('.count')?.textContent ?? undefined;
}

async function tick(): Promise<void> {
  await nextTick();
  await new Promise((r) => setTimeout(r, 250));
}

/** A page with a counter, so a remount is visible as a reset to 0. */
function counterPage(name: string) {
  return defineComponent({
    name,
    setup() {
      const n = ref(0);
      return () =>
        h('view', { class: name }, [
          h('text', { class: 'count', onClick: () => n.value++ }, String(n.value)),
        ]);
    },
  });
}

const Shell = defineComponent({
  name: 'TabShell',
  props: { route: { type: Object, required: true } },
  setup: (props, { slots }) => () =>
    h('view', { class: 'shell' }, [
      h('text', { class: 'title' }, String((props.route as { path: string }).path)),
      h('scroll-view', { class: 'body', style: 'display:block;height:200px;overflow:auto;' }, [
        h('view', { style: 'height:800px;' }, slots.default?.()),
      ]),
    ]),
});

function mountApp() {
  const app = createFjsApp({
    routes: [
      { path: '/', meta: { tab: 0 }, component: counterPage('home') },
      { path: '/api', meta: { tab: 1 }, component: counterPage('api') },
      { path: '/detail', component: counterPage('detail') },
    ],
    shell: Shell,
    el: '#app',
  });
  app.mount();
  return app;
}

async function ready(app: ReturnType<typeof mountApp>): Promise<void> {
  await (
    app.router as unknown as { vueRouter: { isReady: () => Promise<void> } }
  ).vueRouter.isReady();
  await tick();
}

function bump(times: number): void {
  for (let i = 0; i < times; i++) {
    (document.querySelector('.count') as HTMLElement).click();
  }
}

describe('web tab keep-alive', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.getElementById('app')?.remove();
    history.replaceState(null, '', '#/');
  });

  it('a tab switch keeps the leaving page alive; leaving the tabs drops it', async () => {
    const app = mountApp();
    await ready(app);

    bump(3);
    shellBody().scrollTop = 120;
    await tick();
    expect(count()).toBe('3');

    await app.router.replace('/api');
    await tick();
    expect(document.querySelector('.title')?.textContent).toBe('/api');
    expect(count()).toBe('0'); // a tab visited for the first time is fresh
    expect(shellBody().scrollTop).toBe(0);
    bump(1);

    await app.router.replace('/');
    await tick();
    expect(count()).toBe('3');
    expect(shellBody().scrollTop).toBe(120);

    await app.router.replace('/api');
    await tick();
    expect(count()).toBe('1');

    // a push over the tabs, then back: the parked tabs are untouched
    await app.router.push('/detail');
    await tick();
    expect(document.querySelector('.title')?.textContent).toBe('/detail');
    app.router.back();
    await tick();
    expect(count()).toBe('1');
    await app.router.replace('/');
    await tick();
    expect(count()).toBe('3');

    // replacing the base page with a page outside the tab group ends it
    await app.router.replace('/detail');
    await tick();
    await app.router.replace('/api');
    await tick();
    expect(count()).toBe('0');
  });
});
