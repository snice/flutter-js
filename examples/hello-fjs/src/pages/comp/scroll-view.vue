<route>
{"title": "可滚动视图", "tag": "scroll-view", "group": "视图容器"}
</route>

<script setup lang="ts">
// scroll-view：映射 SingleChildScrollView，direction: 'horizontal' 可横向。
import Panel from '@/components/Panel.vue';

// 文件名与内置标签同名：显式命名，模板里的 <scroll-view> 才不会被当成自引用。
defineOptions({ name: 'ScrollViewPage' });
</script>

<template>
  <view>
    <Panel title="横向滚动" desc="style.direction: 'horizontal'">
      <scroll-view class="h-scroll">
        <view v-for="n in 10" :key="n" class="tile">
          <text class="tile-t">{{ n }}</text>
        </view>
      </scroll-view>
    </Panel>

    <Panel title="纵向滚动" desc="固定高度容器内滚动">
      <scroll-view class="v-scroll">
        <view v-for="n in 20" :key="n" class="line">
          <text>第 {{ n }} 行</text>
        </view>
      </scroll-view>
    </Panel>

    <Panel title="提示">
      <text class="note">
        本页整体也在一个 scroll-view 里。上千行的长列表请改用 list-view（ListView 懒构建）。
      </text>
    </Panel>
  </view>
</template>

<style scoped>
.h-scroll {
  /* direction 是 scroll-view 自己的样式键，横向滚动就靠它 */
  direction: horizontal;
  flex-direction: row;
  height: 96px;
  gap: 12px;
}
.tile {
  width: 88px;
  height: 88px;
  border-radius: 10px;
  background-color: #007aff;
  align-items: center;
  justify-content: center;
}
.tile-t {
  color: #ffffff;
  font-size: 20px;
  font-weight: 600;
}
.v-scroll {
  height: 180px;
  background-color: #f4f5f7;
  border-radius: 8px;
  padding: 8px;
  gap: 8px;
}
.line {
  background-color: #ffffff;
  border-radius: 6px;
  padding: 10px;
}
.note {
  font-size: 12px;
  color: #999999;
  line-height: 1.6;
}
</style>
