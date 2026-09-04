// @vitest-environment happy-dom
//
// <picker> as a component: opening the sheet, committing or throwing away
// the draft, and the payload each mode emits. The value math itself is
// pinned down in picker-modes.test.ts; this file is about the orchestration
// — and it runs the SAME component both platforms use, so a payload asserted
// here is the payload Flutter sends (specs/008-picker/plan.md §3.6).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref, type Component } from 'vue';
import { FjsPicker } from '../src/components/picker';
import { fjsComponents } from '../src/web/components';
import { PICKER_ITEM_HEIGHT } from '../src/web/components/picker-view';

function mount(props: Record<string, unknown>, label = '选择') {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const app = createApp({
    render: () => h(FjsPicker, props, () => h('text', null, label)),
  } as Component);
  // the sheet is composed of real fjs tags, so give them their web adapters
  for (const [name, component] of Object.entries(fjsComponents)) {
    app.component(name, component as Component);
  }
  app.mount(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const click = async (el: Element | null) => {
  (el as HTMLElement).click();
  await nextTick();
};

/** The sheet is teleported to <body>; its buttons are the bar's. */
const bar = () => [...document.querySelectorAll('.fjs-picker-bar button')];
const sheetOpen = () => document.querySelector('.fjs-picker-wheel') !== null;
const columnItems = () =>
  [...document.querySelectorAll('picker-view-column')].map((c) =>
    [...c.children].map((i) => i.textContent),
  );

describe('opening', () => {
  it('opens on a tap and closes on 取消, without touching the value', async () => {
    const changes: string[] = [];
    const cancels: number[] = [];
    const host = mount({
      mode: 'selector',
      range: ['苹果', '香蕉', '橙子'],
      value: 1,
      onChange: (v: string) => changes.push(v),
      onCancel: () => cancels.push(1),
    });

    expect(sheetOpen()).toBe(false);
    await click(host.querySelector('view'));
    expect(sheetOpen()).toBe(true);

    await click(bar()[0]);
    expect(sheetOpen()).toBe(false);
    expect(cancels).toEqual([1]);
    expect(changes).toEqual([]);
  });

  it('does not open when disabled', async () => {
    const host = mount({ mode: 'selector', range: ['a'], disabled: true });
    await click(host.querySelector('view'));
    expect(sheetOpen()).toBe(false);
  });
});

describe('payloads', () => {
  it('selector confirms the index as a string', async () => {
    const changes: string[] = [];
    const host = mount({
      mode: 'selector',
      range: ['苹果', '香蕉', '橙子'],
      value: 2,
      onChange: (v: string) => changes.push(v),
    });
    await click(host.querySelector('view'));
    await click(bar()[1]);
    expect(changes).toEqual(['2']);
  });

  it('selector reads labels through range-key', async () => {
    const host = mount({
      mode: 'selector',
      range: [{ id: 1, name: '苹果' }, { id: 2, name: '香蕉' }],
      rangeKey: 'name',
      value: 0,
    });
    await click(host.querySelector('view'));
    expect(columnItems()).toEqual([['苹果', '香蕉']]);
  });

  it('multiSelector confirms an index array', async () => {
    const changes: string[] = [];
    const host = mount({
      mode: 'multiSelector',
      range: [['a', 'b'], ['x'], ['p', 'q', 'r', 's']],
      value: [1, 0, 3],
      onChange: (v: string) => changes.push(v),
    });
    await click(host.querySelector('view'));
    expect(columnItems()).toHaveLength(3);
    await click(bar()[1]);
    expect(changes).toEqual(['[1,0,3]']);
  });

  it('date confirms YYYY-MM-DD and honours the range', async () => {
    const changes: string[] = [];
    const host = mount({
      mode: 'date',
      value: '2026-09-04',
      start: '2020-01-01',
      end: '2030-12-31',
      onChange: (v: string) => changes.push(v),
    });
    await click(host.querySelector('view'));
    expect(columnItems()).toHaveLength(3);
    await click(bar()[1]);
    expect(changes).toEqual(['2026-09-04']);
  });

  it('time confirms hh:mm', async () => {
    const changes: string[] = [];
    const host = mount({
      mode: 'time',
      value: '09:30',
      start: '09:00',
      end: '21:00',
      onChange: (v: string) => changes.push(v),
    });
    await click(host.querySelector('view'));
    await click(bar()[1]);
    expect(changes).toEqual(['09:30']);
  });

  it('date with fields="month" drops the day column', async () => {
    const host = mount({
      mode: 'date',
      value: '2026-09-04',
      start: '2020-01-01',
      end: '2030-12-31',
      fields: 'month',
    });
    await click(host.querySelector('view'));
    expect(columnItems()).toHaveLength(2);
  });
});

describe('column changes', () => {
  it('reports which column moved, once', async () => {
    const columnChanges: string[] = [];
    const host = mount({
      mode: 'multiSelector',
      range: [['a', 'b'], ['x', 'y']],
      value: [0, 0],
      onColumnchange: (v: string) => columnChanges.push(v),
    });
    await click(host.querySelector('view'));

    // Drive the wheel the way a finger does: scroll the second column by one
    // row and let it settle. Native scroll / scrollend do not bubble, so the
    // web adapter must listen on each column itself.
    const columns = [...document.querySelectorAll('picker-view-column')];
    const second = columns[1] as HTMLElement;
    Object.defineProperty(second, 'scrollTop', {
      value: PICKER_ITEM_HEIGHT,
      configurable: true,
    });
    second.dispatchEvent(new Event('scrollend'));
    await nextTick();

    expect(columnChanges).toEqual(['{"column":1,"value":1}']);
  });

  it('follows a range the page swapped while the sheet is open', async () => {
    // The linked-column case: the page answers @columnchange by replacing
    // the second column's items, and the OPEN sheet has to show them. This
    // is what specs/008-picker had to un-snapshot `modal` for.
    const ranges = ref<string[][]>([
      ['北京', '上海'],
      ['东城', '西城'],
    ]);
    const el = document.createElement('div');
    document.body.appendChild(el);
    const app = createApp({
      render: () =>
        h(
          FjsPicker,
          { mode: 'multiSelector', range: ranges.value, value: [0, 0] },
          () => h('text', null, '地区'),
        ),
    } as Component);
    for (const [name, component] of Object.entries(fjsComponents)) {
      app.component(name, component as Component);
    }
    app.mount(el);

    await click(el.querySelector('view'));
    expect(columnItems()[1]).toEqual(['东城', '西城']);

    ranges.value = [['北京', '上海'], ['黄浦', '静安', '徐汇']];
    await nextTick();
    await nextTick();
    expect(columnItems()[1]).toEqual(['黄浦', '静安', '徐汇']);
  });
});
