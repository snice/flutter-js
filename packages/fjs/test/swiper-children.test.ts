// <swiper> children must be <swiper-item> (specs/051). One check, three
// compile paths: the pure function, and compileTemplate with the transform
// the Flutter and web builds pass it.
import { describe, expect, it } from 'vitest';
import { baseParse, NodeTypes, type ElementNode } from '@vue/compiler-core';
import { compileTemplate } from '@vue/compiler-sfc';
import {
  swiperChildViolations,
  swiperChildrenTransform,
} from '../src/template/swiper-children';

function violations(template: string) {
  const root = baseParse(template);
  const swiper = root.children.find((c) => c.type === NodeTypes.ELEMENT) as ElementNode;
  return swiperChildViolations(swiper).map((v) => v.what);
}

describe('swiperChildViolations', () => {
  it('accepts swiper-item pages, comments, blank text and slots', () => {
    expect(
      violations(`<swiper>
        <!-- pages -->
        <swiper-item v-for="s in list" :key="s"><view /></swiper-item>
        <swiper-item v-if="a" /><swiper-item v-else />
        <SwiperItem />
        <slot />
      </swiper>`),
    ).toEqual([]);
  });

  it('looks through <template> to its children', () => {
    expect(
      violations('<swiper><template v-for="s in list"><swiper-item /></template></swiper>'),
    ).toEqual([]);
    expect(
      violations('<swiper><template v-for="s in list"><view /></template></swiper>'),
    ).toEqual(['<view>']);
  });

  it('rejects bare elements, components, text and interpolation', () => {
    expect(
      violations('<swiper><view v-for="s in list" /><Card />hello{{ x }}</swiper>'),
    ).toEqual(['<view>', '<Card>', 'text "hello"', '{{ x }}']);
  });

  it('ignores anything that is not a swiper', () => {
    expect(violations('<view><view /></view>')).toEqual([]);
  });
});

function compile(source: string) {
  return compileTemplate({
    source,
    filename: 'page.vue',
    id: 'x',
    compilerOptions: { nodeTransforms: [swiperChildrenTransform] },
  });
}

describe('swiperChildrenTransform', () => {
  it('reports a bare child with its position', () => {
    const r = compile('<swiper>\n  <view v-for="s in list" :key="s" />\n</swiper>');
    expect(r.errors).toHaveLength(1);
    const err = r.errors[0] as SyntaxError & { loc: { start: { line: number; column: number } } };
    expect(err.message).toContain('<swiper> 的直接子节点必须是 <swiper-item>，发现 <view>');
    expect(err.loc.start).toMatchObject({ line: 2, column: 3 });
  });

  it('sees source structure under v-if / v-else on the swiper and its pages', () => {
    const r = compile(`<swiper v-if="ok">
      <swiper-item v-if="a" /><swiper-item v-else-if="b" /><swiper-item v-else />
    </swiper>
    <view v-else />`);
    expect(r.errors).toEqual([]);
  });
});
