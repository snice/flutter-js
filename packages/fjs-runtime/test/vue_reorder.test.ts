// Keyed v-for reorders: Vue moves a mounted node by calling insert() again,
// and the native side detaches the child before re-inserting it. This test
// replays the op stream with those semantics and checks the tree ends up in
// the order the array is in — a move that lands one slot off is invisible in
// the browser (insertBefore moves natively) and only shows up on Flutter.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { h, ref } from '@vue/runtime-core';
import { setOpSink } from '../src/host';
import { createApp, flutterRoot } from '../src/vue';

const enum Op {
  Create = 1,
  Remove = 2,
  Insert = 3,
  RemoveChild = 4,
  SetText = 5,
  SetProps = 6,
}

/** The native mirror tree, with flutter_fjs's mirror_tree.dart semantics. */
class Mirror {
  readonly children = new Map<number, number[]>();
  readonly parent = new Map<number, number>();
  readonly text = new Map<number, string>();
  readonly tag = new Map<number, string>();

  kids(id: number): number[] {
    let list = this.children.get(id);
    if (!list) this.children.set(id, (list = []));
    return list;
  }

  detach(id: number): void {
    const parent = this.parent.get(id);
    if (parent === undefined) return;
    const list = this.kids(parent);
    const at = list.indexOf(id);
    if (at >= 0) list.splice(at, 1);
    this.parent.delete(id);
  }

  apply(bytes: Uint8Array): void {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const dec = new TextDecoder();
    let i = 0;
    const u32 = () => {
      const v = view.getUint32(i, true);
      i += 4;
      return v;
    };
    const u16 = () => {
      const v = view.getUint16(i, true);
      i += 2;
      return v;
    };
    const str = (len: number) => {
      const v = dec.decode(bytes.subarray(i, i + len));
      i += len;
      return v;
    };
    while (i < bytes.length) {
      const op = bytes[i++];
      switch (op) {
        case Op.Create: {
          const id = u32();
          this.tag.set(id, str(u16()));
          break;
        }
        case Op.Remove: {
          const id = u32();
          this.detach(id);
          this.children.delete(id);
          this.tag.delete(id);
          break;
        }
        case Op.Insert: {
          const parent = u32();
          const child = u32();
          const index = u32();
          this.detach(child);
          const list = this.kids(parent);
          list.splice(Math.min(index, list.length), 0, child);
          this.parent.set(child, parent);
          break;
        }
        case Op.RemoveChild: {
          const parent = u32();
          const child = u32();
          const list = this.kids(parent);
          const at = list.indexOf(child);
          if (at >= 0) list.splice(at, 1);
          this.parent.delete(child);
          break;
        }
        case Op.SetText: {
          const id = u32();
          this.text.set(id, str(u32()));
          break;
        }
        case Op.SetProps: {
          u32();
          i += u32();
          break;
        }
        default:
          throw new Error(`unknown op ${op} at ${i - 1}`);
      }
    }
  }

  /** The row labels of [id]'s children, in tree order. */
  labels(id: number): string[] {
    return this.kids(id).map((child) => this.text.get(child) ?? '');
  }

  /** The one node whose children are the rows. */
  rowParent(): number {
    for (const [id, kids] of this.children) {
      if (kids.length >= 3 && kids.every((k) => this.text.has(k))) return id;
    }
    throw new Error('no row container in the tree');
  }
}

const mirror = new Mirror();

async function flush(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

beforeAll(() => {
  setOpSink((frame) => mirror.apply(frame));
});

afterEach(() => {
  mirror.children.clear();
  mirror.parent.clear();
  mirror.text.clear();
  mirror.tag.clear();
});

describe('keyed reorder', () => {
  it('moves a row to the slot the array puts it in', async () => {
    const items = ref([1, 2, 3, 4, 5, 6]);
    const app = createApp({
      render: () =>
        h(
          'view',
          null,
          items.value.map((n) => h('text', { key: n }, `row${n}`)),
        ),
    });
    app.mount(flutterRoot('view'));
    await flush();
    const rows = mirror.rowParent();
    expect(mirror.labels(rows)).toEqual([
      'row1', 'row2', 'row3', 'row4', 'row5', 'row6',
    ]);

    // forward: the first row is dropped between 3 and 4. Vue moves it by
    // inserting it before row4, which is where an index read off the stale
    // list would put it one slot too late.
    items.value = [2, 3, 1, 4, 5, 6];
    await flush();
    expect(mirror.labels(rows)).toEqual([
      'row2', 'row3', 'row1', 'row4', 'row5', 'row6',
    ]);

    // backward, and a move to the very end
    items.value = [2, 1, 3, 4, 5, 6];
    await flush();
    expect(mirror.labels(rows)).toEqual([
      'row2', 'row1', 'row3', 'row4', 'row5', 'row6',
    ]);

    items.value = [1, 3, 4, 5, 6, 2];
    await flush();
    expect(mirror.labels(rows)).toEqual([
      'row1', 'row3', 'row4', 'row5', 'row6', 'row2',
    ]);

    // a reversal, which moves nearly every row
    items.value = [6, 5, 4, 3, 2, 1];
    await flush();
    expect(mirror.labels(rows)).toEqual([
      'row6', 'row5', 'row4', 'row3', 'row2', 'row1',
    ]);
  });

  it('keeps inserting and removing rows correct', async () => {
    const items = ref([1, 2, 3]);
    const app = createApp({
      render: () =>
        h(
          'view',
          null,
          items.value.map((n) => h('text', { key: n }, `row${n}`)),
        ),
    });
    app.mount(flutterRoot('view'));
    await flush();
    const rows = mirror.rowParent();

    items.value = [1, 4, 2, 3];
    await flush();
    expect(mirror.labels(rows)).toEqual(['row1', 'row4', 'row2', 'row3']);

    items.value = [4, 3];
    await flush();
    expect(mirror.labels(rows)).toEqual(['row4', 'row3']);
  });
});
