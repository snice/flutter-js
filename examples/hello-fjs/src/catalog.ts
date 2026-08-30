// 组件目录：直接从生成的路由表里推导，不再手写页面列表。
//
// 每个 src/pages/comp/*.vue 用 <route> 块声明自己的 tag / title / group，
// 所以「某个页面 app 有、web 没有」只要在那个页面里写 "platforms": ["app"]，
// 首页手风琴自然就少一条——这份目录读到的就是当前平台真正存在的路由。
//
// 惰性求值：pages 表 import 了每个页面，页面又 import 了这个文件，模块图上
// 是个环。放到函数里求值，等首页真正渲染时 routes 已经初始化好了。
import { routes } from 'fjs/pages';

export interface Entry {
  tag: string;
  title: string;
  path: string;
}

export interface Category {
  name: string;
  items: Entry[];
}

/** 手风琴的分组顺序（路由表本身是按文件名排的）。 */
const ORDER = ['视图容器', '基础内容', '表单组件', '交互反馈'];

let cache: Category[] | null = null;

export function catalog(): Category[] {
  return (cache ??= ORDER.map((name) => ({
    name,
    items: routes
      .filter((route) => route.meta?.group === name)
      .map((route) => ({
        tag: String(route.meta?.tag ?? route.name),
        title: String(route.meta?.title ?? ''),
        path: route.path,
      })),
  })).filter((category) => category.items.length > 0));
}

export function totalPages(): number {
  return catalog().reduce((n, c) => n + c.items.length, 0);
}
