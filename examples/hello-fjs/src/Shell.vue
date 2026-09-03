<script setup lang="ts">
// 应用外壳：safe-area 内 [导航栏 | 可滚动页面 | tabBar]。
// 每个路由页面都被它包一层——Flutter 侧一个页面就是一个原生 Navigator
// 路由（手势返回和转场由平台负责），web 侧是 <router-view> 的内容。
import { computed } from 'vue';
import type { RouteLocation } from 'fjs/router';
import NavBar from './components/NavBar.vue';
import TabBar from './components/TabBar.vue';
import { useTheme } from './theme';

// 主题只在这里落地一次：整棵页面树都在 .shell 底下，自定义属性沿树继承，
// 所以切主题就是改这一个节点的内联样式。
const { vars } = useTheme();

const props = defineProps<{ route: RouteLocation }>();

// tab 首页没有返回按钮，二级页没有 tabBar
const tab = computed(() =>
  typeof props.route.meta.tab === 'number' ? (props.route.meta.tab as number) : null,
);
const title = computed(() => String(props.route.meta.title ?? ''));

// 页面可以用 `<route>{"scroll": false}</route>` 说「我自己管滚动」。
//
// 这不是个偏好开关，是个正确性开关：外壳的 scroll-view 给内容的是**无界**高度，
// 所以页面里再套一个滚动容器，内层视口就和它的内容一样高——`list-view` 没有可
// 虚拟化的窗口，离屏 paint 裁剪也没有可裁的窗口。自带长列表的页面必须关掉它。
const scrolls = computed(() => props.route.meta.scroll !== false);
</script>

<template>
  <safe-area>
    <view class="shell" :style="vars">
      <NavBar :title="title" :back="tab === null" />
      <scroll-view v-if="scrolls" class="body">
        <slot />
      </scroll-view>
      <view v-else class="body">
        <slot />
      </view>
      <TabBar v-if="tab !== null" :active="tab" />
    </view>
  </safe-area>
</template>

<style scoped>
.shell {
  flex-grow: 1;
  background-color: var(--fjs-page);
}
.body {
  flex-grow: 1;
}
</style>
