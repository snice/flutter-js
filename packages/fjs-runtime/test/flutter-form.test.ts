// The Flutter path's <form>: a Vue component over the JS shadow tree
// (src/components/form.ts), not a Dart tag.
//
// The payloads asserted here are the same strings the web adapter's
// implementation produces (web-form.test.ts) — that pair is the two-ends
// contract for this tag.
import { beforeEach, describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import {
  childElementIds,
  createApp,
  elementTag,
  flutterRoot,
} from '../src/vue/renderer';
import { FjsForm } from '../src/components/form';
import { installEventDispatcher } from '../src/ui/element';
import { setOpSink } from '../src/host';

// No host: the frames go nowhere. What the component needs is the
// renderer's own bookkeeping (ids and the shadow tree), which happens
// before the sink.
(globalThis as { __fjsHost?: { uiOpsVersion: number } }).__fjsHost = {
  uiOpsVersion: 2,
};

type Dispatch = (id: number, type: number, payload: string | null) => void;
const dispatchEvent = () =>
  (globalThis as { __fjsDispatchEvent?: Dispatch }).__fjsDispatchEvent!;

beforeEach(() => {
  setOpSink(() => {});
  installEventDispatcher();
});

const TAP = 1;
const TEXT_CHANGED = 3;
const VALUE_CHANGED = 5;

/** The page shape the demo uses: fields nested inside another component, so
 * neither slots nor provide/inject could find them. */
const Panel = defineComponent({
  setup: (_p, { slots }) => () => h('view', { class: 'card' }, slots.default?.()),
});

/** Ids are global and keep climbing across tests, so find nodes by walking
 * the same shadow tree the component walks. */
function findByTag(rootId: number, tag: string): number[] {
  const out: number[] = [];
  const visit = (id: number) => {
    if (elementTag(id) === tag) out.push(id);
    for (const kid of childElementIds(id)) visit(kid);
  };
  visit(rootId);
  return out;
}

async function mountForm(children: () => unknown, handlers: Record<string, unknown> = {}) {
  const submits: string[] = [];
  const resets: number[] = [];
  const App = defineComponent(() => () =>
    h(
      FjsForm,
      {
        onSubmit: (v: string) => submits.push(v),
        onReset: () => resets.push(1),
        ...handlers,
      },
      children,
    ),
  );
  const root = flutterRoot();
  createApp(App).mount(root as never);
  await nextTick();
  const find = (tag: string) => findByTag(root.id, tag);
  return { submits, resets, find };
}

/** Ids are handed out in creation order, so the nth created element is
 * root.id + n; the tests below find controls by driving events at them. */
function dispatch(nodeId: number, type: number, payload: string | null) {
  dispatchEvent()(nodeId, type, payload);
}

describe('flutter <form>', () => {
  it('collects fields nested inside another component', async () => {
    const { submits, find } = await mountForm(() => [
      h(Panel, null, () => [
        h('input', { name: 'nickname' }),
        h('switch', { name: 'agree', value: false }),
      ]),
      h('button', { 'form-type': 'submit' }, 'go'),
    ]);
    dispatch(find('input')[0], TEXT_CHANGED, 'zhe');
    dispatch(find('switch')[0], VALUE_CHANGED, '1');
    await nextTick();

    // the form wired the button's tap itself
    dispatch(find('button')[0], TAP, null);
    expect(submits).toEqual(['{"nickname":"zhe","agree":true}']);
  });

  it('includes untouched fields with their bound value', async () => {
    const { submits, find } = await mountForm(() => [
      h('input', { name: 'nickname' }),
      h('slider', { name: 'level', value: 30 }),
      h('button', { 'form-type': 'submit' }, 'go'),
    ]);
    dispatch(find('button')[0], TAP, null);
    expect(submits).toEqual(['{"nickname":"","level":30}']);
  });

  it('lets a group speak for its members', async () => {
    const { submits, find } = await mountForm(() => [
      h('checkbox-group', { name: 'tags' }, [
        h('checkbox', { name: 'x' }),
        h('checkbox', { name: 'y' }),
      ]),
      h('radio-group', { name: 'plan' }, [h('radio', { name: 'free' })]),
      h('button', { 'form-type': 'submit' }, 'go'),
    ]);
    // the checkbox-group's own payload, as widgets/group.dart sends it
    dispatch(find('checkbox-group')[0], VALUE_CHANGED, '["y"]');
    await nextTick();
    dispatch(find('button')[0], TAP, null);
    expect(submits).toEqual(['{"tags":["y"],"plan":""}']);
  });

  it('fires reset without touching any value', async () => {
    const { submits, resets, find } = await mountForm(() => [
      h('input', { name: 'a', value: 'x' }),
      h('button', { 'form-type': 'reset' }, 'clear'),
    ]);
    dispatch(find('button')[0], TAP, null);
    expect(resets).toEqual([1]);
    expect(submits).toEqual([]);
  });
});
