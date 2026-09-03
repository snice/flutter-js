<script setup lang="ts">
// 压测页的行列表，单独成组件——这本身就是被测的东西。
//
// 主题是通过继承的 CSS 自定义属性到达每一行的，不走 props，所以一行的 vnode
// 输出跟主题无关。只要这个组件不读主题 ref，切主题时 Vue 的
// shouldUpdateComponent 看到 props 没变，就会整个跳过它——4000 个 vnode 的
// 重建和 diff 一次都不做。
//
// 实测（examples/bench）1000 行切主题：内联 56.95ms，独立组件 35.22ms，
// 两边过桥的字节数一模一样。省下的 21.7ms 全是 Vue 自己的 diff。
defineProps<{
  items: { id: number; title: string; meta: string; badge: string }[];
  /** 行的容器标签。`scroll-view` 把每一行都 build/layout，`list-view` 只落实
   * 视口里的那十几行——压测页用这个开关对拍两者，见 docs/performance.md。 */
  container: 'scroll-view' | 'list-view';
}>();
</script>

<template>
  <component :is="container" class="rows">
    <view v-for="item in items" :key="item.id" class="item">
      <text class="item-title">{{ item.title }}</text>
      <text class="item-meta">{{ item.meta }}</text>
      <view v-if="item.badge" class="badge">
        <text class="badge-text">{{ item.badge }}</text>
      </view>
    </view>
  </component>
</template>

<style scoped>
/* 和 theme.vue 里内联那一份同值：容器是这个组件的根，作用域样式要写在这边
   才落得下来。 */
.rows {
  flex-grow: 1;
  padding-bottom: 24px;
}

.item {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  margin: 0 12px 6px 12px;
  padding: 12px 16px;
  border-radius: 8px;
  border-color: var(--fjs-border);
  background-color: var(--fjs-card);
}
.item:active {
  background-color: var(--fjs-card-active);
}
.item-title {
  flex-grow: 1;
  font-size: 15px;
  color: var(--fjs-title);
}
.item-meta {
  font-size: 12px;
  color: var(--fjs-muted);
}
.badge {
  /* 行里没有 flex-grow 的子节点拿到的是无界宽度，而 view 默认是 column、
     交叉轴默认 stretch —— 两件事撞在一起就是「给文字一个无限宽」。显式写
     align-items 是这一类的通解，见 docs/css-compat.md 的 align-items 一行。 */
  align-items: center;
  border-radius: 4px;
  padding: 2px 6px;
  background-color: var(--fjs-primary);
}
.badge-text {
  font-size: 10px;
  color: #ffffff;
}
</style>
