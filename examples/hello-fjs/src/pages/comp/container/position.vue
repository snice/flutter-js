<route>
{"title": "定位", "tag": "position", "group": "视图容器"}
</route>

<script setup lang="ts">
// 定位：任何盒子写 position: relative 就成了定位上下文，子节点用
// position: absolute + top/left/right/bottom 摆在它上面（没有 stack 标签，
// 这就是 CSS 本来的写法）。其余子节点照常走 flex。
import Panel from '@/components/Panel.vue';

defineOptions({ name: 'PositionPage' });
</script>

<template>
  <view>
    <Panel title="层叠定位" desc="position: relative + absolute + top/right/bottom/left">
      <view class="poster">
        <text class="poster-title">海报标题</text>
        <view class="poster-tag"><text class="poster-tag-t">HOT</text></view>
      </view>
    </Panel>

    <Panel title="角标" desc="常见的头像 + 未读红点">
      <view class="badge-box">
        <view class="badge-avatar"><text class="badge-icon">A</text></view>
        <view class="badge"><text class="badge-t">9</text></view>
      </view>
    </Panel>
  </view>
</template>

<style scoped>
.poster {
  position: relative;
  height: 160px;
  border-radius: 10px;
  background: linear-gradient(180deg, #4facfe 0%, #00f2fe 100%);
}
.poster-title {
  position: absolute;
  left: 16px;
  bottom: 16px;
  color: #ffffff;
  font-size: 18px;
  font-weight: 600;
}
.poster-tag {
  position: absolute;
  /* 列默认 stretch：不加这句，没有显式宽度的绝对定位块会被拉开 */
  align-items: flex-start;
  top: 12px;
  right: 12px;
  background-color: #dd524d;
  border-radius: 10px;
  padding: 2px 8px;
}
.poster-tag-t {
  color: #ffffff;
  font-size: 11px;
}
.badge-box {
  position: relative;
  overflow: visible;
  width: 56px;
  height: 56px;
}
.badge-avatar {
  width: 56px;
  height: 56px;
  border-radius: 12px;
  background-color: #eef4ff;
  align-items: center;
  justify-content: center;
}
.badge-icon {
  /* 头像用字母而不是 ✉ 这类字符：emoji 系的码位（✉ ★ ☎ 以及真 emoji）在
     Flutter 上要靠系统 emoji 字体，某些 iOS 版本上取不到就是一个方框，而
     web 有浏览器自己的回退链——图标该用 iconfont 或图片，别用 emoji */
  color: #007aff;
  font-size: 20px;
  font-weight: 600;
}
.badge {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 20px;
  height: 20px;
  border-radius: 10px;
  background-color: #dd524d;
  align-items: center;
  justify-content: center;
}
.badge-t {
  color: #ffffff;
  font-size: 11px;
}
</style>
