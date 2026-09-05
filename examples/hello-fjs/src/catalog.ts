// 页面目录：直接从生成的路由表里推导，不再手写页面列表。
//
// 每个 src/pages/**/*.vue 用 <route> 块声明自己的 tag / title / group，
// 所以「某个页面 app 有、web 没有」只要在那个页面里写 "platforms": ["app"]，
// 手风琴自然就少一条——这份目录读到的就是当前平台真正存在的路由。
//
// 惰性求值：pages 表 import 了每个页面，页面又 import 了这个文件，模块图上
// 是个环。放到函数里求值，等页面真正渲染时 routes 已经初始化好了。
import { routes } from 'fjs/pages';

export interface Entry {
  /** 组件页用的标签名（<button>）；示例页留空。 */
  tag: string;
  title: string;
  /** 一句话说明，示例页显示在标题下面。 */
  desc: string;
  path: string;
}

export interface Category {
  name: string;
  items: Entry[];
}

/** 首页（内置组件）的分组顺序（路由表本身是按文件名排的）。 */
const COMPONENTS = ['视图容器', '基础内容', '表单组件', '画布', '网页', '交互反馈'];

/** 示例页的分组顺序。 */
const EXAMPLES = ['交互演示', '交互游戏', "画布演示"];

const cache = new Map<string, Category[]>();

/** 按给定顺序，把带 `group` 元信息的路由收成手风琴分组。 */
function group(order: string[]): Category[] {
  const key = order.join('|');
  const hit = cache.get(key);
  if (hit) return hit;
  const built = order
    .map((name) => ({
      name,
      items: routes
        .filter((route) => route.meta?.group === name)
        .map((route) => ({
          tag: String(route.meta?.tag ?? route.name),
          title: String(route.meta?.title ?? ''),
          desc: String(route.meta?.desc ?? ''),
          path: route.path,
        })),
    }))
    .filter((category) => category.items.length > 0);
  cache.set(key, built);
  return built;
}

export function catalog(): Category[] {
  return group(COMPONENTS);
}

export function examples(): Category[] {
  return group(EXAMPLES);
}

export function totalPages(): number {
  return catalog().reduce((n, c) => n + c.items.length, 0);
}
