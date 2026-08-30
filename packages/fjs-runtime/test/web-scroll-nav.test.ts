// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { createFjsApp } from '../src/app/web';

function shellBody(): HTMLElement {
  const el = document.querySelector('scroll-view.body');
  if (!el) throw new Error('missing scroll-view.body');
  return el as HTMLElement;
}

async function tick(): Promise<void> {
  await nextTick();
  await new Promise((r) => setTimeout(r, 250));
}

describe('web page scroll across navigation', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.getElementById('app')?.remove();
    history.replaceState(null, '', '#/');
  });

  it('push starts at 0; back restores the previous shell scroll-view', async () => {
    const Home = defineComponent({
      name: 'HomePage',
      setup: () => () => h('view', { class: 'home' }, 'home'),
    });
    const Detail = defineComponent({
      name: 'DetailPage',
      setup: () => () => h('view', { class: 'detail' }, 'detail'),
    });
    const Shell = defineComponent({
      name: 'TestShell',
      props: { route: { type: Object, required: true } },
      setup: (props, { slots }) => () =>
        h('view', { class: 'shell' }, [
          h('text', { class: 'title' }, String((props.route as { path: string }).path)),
          h(
            'scroll-view',
            {
              class: 'body',
              style: 'display:block;height:200px;overflow:auto;',
            },
            [
              h('view', { style: 'height:800px;' }, slots.default?.()),
            ],
          ),
        ]),
    });

    async function run(keepAlive: boolean | number) {
      const app = createFjsApp({
        routes: [
          { path: '/', component: Home },
          { path: '/detail', component: Detail },
        ],
        shell: Shell,
        keepAlive,
        el: '#app',
      });
      app.mount();
      await (app.router as unknown as { vueRouter: { isReady: () => Promise<void> } }).vueRouter.isReady();
      await tick();

      expect(document.querySelector('.title')?.textContent).toBe('/');
      const home = shellBody();
      home.scrollTop = 140;
      expect(home.scrollTop).toBe(140);

      await app.router.push('/detail');
      await tick();

      expect(document.querySelector('.title')?.textContent).toBe('/detail');
      expect(document.querySelector('.detail')).toBeTruthy();
      expect(shellBody().scrollTop).toBe(0);

      app.router.back();
      await tick();

      expect(document.querySelector('.title')?.textContent).toBe('/');
      expect(shellBody().scrollTop).toBe(140);

      // pop drops the detail shot — a second push must start at 0
      await app.router.push('/detail');
      await tick();
      expect(shellBody().scrollTop).toBe(0);
      shellBody().scrollTop = 80;
      expect(shellBody().scrollTop).toBe(80);

      app.router.back();
      await tick();
      expect(shellBody().scrollTop).toBe(140);

      await app.router.push('/detail');
      await tick();
      expect(document.querySelector('.title')?.textContent).toBe('/detail');
      expect(shellBody().scrollTop).toBe(0);

      // browser / phone back is history.back(), not router.back()
      shellBody().scrollTop = 60;
      history.back();
      await tick();
      expect(document.querySelector('.title')?.textContent).toBe('/');
      expect(shellBody().scrollTop).toBe(140);

      await app.router.push('/detail');
      await tick();
      expect(document.querySelector('.title')?.textContent).toBe('/detail');
      expect(shellBody().scrollTop).toBe(0);
    }

    await run(true);
    document.body.innerHTML = '';
    document.getElementById('app')?.remove();
    history.replaceState(null, '', '#/');
    await run(false);
  });
});
