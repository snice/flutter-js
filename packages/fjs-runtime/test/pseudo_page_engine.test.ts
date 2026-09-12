// spec 040 对拍辅助：把 pseudo.vue 的 scoped CSS 按真实树跑一遍引擎，
// 对出 App 端会收到的计算样式（web 端是真 CSS，不经过这里）。
import { describe, expect, it, vi } from 'vitest';
import { StyleEngine } from '../src/css/style';

async function tick(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

const SCOPE = 'data-v-pseudo';

// pseudo.vue <style scoped> 的有效内容
const CSS = `
.hint { font-size: 12px; color: var(--fjs-faint); line-height: 18px; }
.row { flex-direction: row; }
.gap { gap: 8px; flex-wrap: wrap; }
.list { background-color: #eeeeee; border-radius: 10px; gap: 1px; }
.row-text { font-size: 14px; color: var(--fjs-text); }
.list .row { background-color: #ffffff; padding: 12 16; }
.list .row:first-child { border-radius: 10px 10px 0 0; }
.list .row:last-child { border-radius: 0 0 10px 10px; }
.mix { flex-direction: row; align-items: center; gap: 6px; }
.mix-label { font-size: 13px; color: var(--fjs-muted); }
.chip { background-color: #f5f5f5; border-radius: 6px; padding: 4 8; }
.chip.first { background-color: #e8f7e8; }
.chip-text { font-size: 12px; color: #333333; }
.hover-box { background-color: #ffffff; border: 1px solid #dddddd; border-radius: 8px; padding: 10 16; }
.hover-box:hover { background-color: #f2f2f2; }
.hover-box.press:active { background-color: #eef4ff; }
.hover-text { font-size: 13px; color: #333333; }
`;

describe('pseudo.vue engine output (App path)', () => {
  it('computes the list rows, hover containers and variants as web does', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const parentOf = new Map<number, number | null>();
    const childrenOf = new Map<number, number[]>();
    const applied = new Map<number, Record<string, unknown>>();
    const appliedHover = new Map<number, Record<string, unknown> | null>();
    const engine = new StyleEngine(parentOf, childrenOf, (id, style, _active, hover) => {
      applied.set(id, style);
      if (hover !== undefined) appliedHover.set(id, hover);
    });
    const add = (id: number, tag: string, parent: number | null, cls?: string, scope?: string) => {
      parentOf.set(id, parent);
      childrenOf.set(id, []);
      if (parent != null) childrenOf.get(parent)!.push(id);
      engine.ensure(id, tag);
      if (cls) engine.setClasses(id, cls);
      if (scope) engine.addScope(id, scope);
      return id;
    };

    engine.register(SCOPE, CSS);

    // page root > Panel(.section > .card) > 页面元素（slot 内容带页面 scope）
    add(1, 'view', null, undefined, SCOPE);
    const card = add(2, 'view', 1, 'card', 'data-v-panel');
    // 卡片里还有 hint 等兄弟，直接列关键子树
    const list = add(10, 'view', card, 'list', SCOPE);
    const rows = [20, 21, 22, 23];
    for (const id of rows) {
      add(id, 'view', list, 'row', SCOPE);
      add(id + 100, 'text', id, 'row-text', SCOPE);
    }
    // 悬停面板：.row.gap 容器 + 两个 hover-box
    const hrow = add(30, 'view', card, 'row gap', SCOPE);
    const box1 = add(31, 'view', hrow, 'hover-box', SCOPE);
    add(32, 'text', box1, 'hover-text', SCOPE);
    const box2 = add(33, 'view', hrow, 'hover-box press', SCOPE);
    add(34, 'text', box2, 'hover-text', SCOPE);

    engine.noteStructureChange(list);
    engine.noteStructureChange(hrow);
    await tick();

    const style = (id: number) => applied.get(id) ?? {};
    // 列表：分隔线是容器底色从 1px 缝隙里透出来的；首末行收圆角
    expect(style(10)).toMatchObject({ backgroundColor: '#eeeeee', gap: 1, borderRadius: 10 });
    expect(style(20)).toMatchObject({ backgroundColor: '#ffffff', borderRadius: '10px 10px 0 0' });
    expect(style(21)).toMatchObject({ backgroundColor: '#ffffff' });
    expect(style(21).borderRadius).toBeUndefined();
    expect(style(23)).toMatchObject({ borderRadius: '0 0 10px 10px' });
    // 悬停容器：row + wrap 都在
    expect(style(30)).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap', gap: 8 });
    // hover-box：白底 + 边框是普通样式；灰底只在 hover 变体里
    expect(style(31)).toMatchObject({ backgroundColor: '#ffffff', border: '1px solid #dddddd' });
    expect(appliedHover.get(31)).toMatchObject({ backgroundColor: '#f2f2f2' });
    expect(appliedHover.get(33)).toMatchObject({ backgroundColor: '#f2f2f2' });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
