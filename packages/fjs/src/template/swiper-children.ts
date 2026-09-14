// <swiper> pages through <swiper-item> children only (specs/051).
//
// One check for all three compile paths — the Flutter esbuild plugin and the
// Vite web build hand `swiperChildrenTransform` to compileTemplate, and the
// mini-program codegen calls `swiperChildViolations` on its own parse tree.
// Before this, each end had its own idea of a page: mp wrapped bare children
// at compile time, web wrapped every child again at runtime (two levels when
// the page already wrote <swiper-item>), and Flutter took bare children as
// pages without the swiper-item fill rules.
//
// Why an error and not an automatic wrapper (what mp used to do): the
// wrapper has to take over the child's v-for / v-if / :key, and inside
// compileTemplate that rewrite fights transformIf, which finds a v-else by
// looking at its previous sibling. An error also keeps the source what wx
// requires, so the page reads the same on every target.
import {
  NodeTypes,
  type ElementNode,
  type NodeTransform,
  type SourceLocation,
  type TemplateChildNode,
} from '@vue/compiler-core';

const SWIPER_TAGS = new Set(['swiper', 'Swiper']);
const ITEM_TAGS = new Set(['swiper-item', 'SwiperItem']);

export interface SwiperChildViolation {
  /** `<view>`, `text "abc"`, `{{ }}` — what the message shows. */
  what: string;
  loc: SourceLocation;
}

export function isSwiperTag(tag: string): boolean {
  return SWIPER_TAGS.has(tag);
}

/** Direct children of [el] that are not a page. Empty when [el] is not a
 * swiper. */
export function swiperChildViolations(el: ElementNode): SwiperChildViolation[] {
  if (!SWIPER_TAGS.has(el.tag)) return [];
  const out: SwiperChildViolation[] = [];
  collect(el.children, out);
  return out;
}

function collect(children: TemplateChildNode[], out: SwiperChildViolation[]): void {
  for (const child of children) {
    switch (child.type) {
      case NodeTypes.COMMENT:
        continue;
      case NodeTypes.TEXT:
        if (child.content.trim() === '') continue;
        out.push({ what: `text "${child.content.trim()}"`, loc: child.loc });
        continue;
      case NodeTypes.ELEMENT: {
        if (ITEM_TAGS.has(child.tag)) continue;
        // a <slot>'s content is the caller's, invisible here; the runtimes
        // still take a bare page and warn
        if (child.tag === 'slot') continue;
        // <template v-for / v-if> is transparent: its children are the pages
        if (child.tag === 'template') {
          collect(child.children, out);
          continue;
        }
        // components included — their root is not known at compile time
        out.push({ what: `<${child.tag}>`, loc: child.loc });
        continue;
      }
      default:
        // interpolation and anything else that renders content
        out.push({ what: child.loc.source.trim() || 'content', loc: child.loc });
    }
  }
}

export function swiperChildMessage(v: SwiperChildViolation): string {
  return `<swiper> 的直接子节点必须是 <swiper-item>，发现 ${v.what}`;
}

/** compileTemplate `nodeTransforms` entry. Runs on ENTER, before the
 * children's own v-if / v-for transforms, so it sees the source structure. */
export const swiperChildrenTransform: NodeTransform = (node, context) => {
  if (node.type !== NodeTypes.ELEMENT) return;
  for (const v of swiperChildViolations(node)) {
    const err = new SyntaxError(swiperChildMessage(v)) as SyntaxError & {
      code: number;
      loc: SourceLocation;
    };
    err.code = 0;
    err.loc = v.loc;
    context.onError(err as never);
  }
};
