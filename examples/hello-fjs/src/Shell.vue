<script setup lang="ts">
// 应用外壳：safe-area 内 [导航栏 | 可滚动页面 | tabBar]。
// 每个路由页面都被它包一层——Flutter 侧一个页面就是一个原生 Navigator
// 路由（手势返回和转场由平台负责），web 侧是 <router-view> 的内容。
import { computed } from 'vue';
import type { RouteLocation } from 'fjs/router';
import NavBar from './components/NavBar.vue';
import TabBar from './components/TabBar.vue';

const props = defineProps<{ route: RouteLocation }>();

// tab 首页没有返回按钮，二级页没有 tabBar
const tab = computed(() =>
  typeof props.route.meta.tab === 'number' ? (props.route.meta.tab as number) : null,
);
const title = computed(() => String(props.route.meta.title ?? ''));
</script>

<template>
  <safe-area>
    <view class="shell">
      <NavBar :title="title" :back="tab === null" />
      <scroll-view class="body">
        <slot />
      </scroll-view>
      <TabBar v-if="tab !== null" :active="tab" />
    </view>
  </safe-area>
</template>

<style scoped>
.shell {
  flex-grow: 1;
  background-color: #f4f5f7;
}
.body {
  flex-grow: 1;
}
</style>
