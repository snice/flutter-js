<route>
{"title": "轮播", "tag": "swiper", "group": "视图容器"}
</route>

<script setup lang="ts">
// swiper：映射 PageView，@page-changed 回派当前索引。
import { ref } from 'vue';
import Panel from '../../components/Panel.vue';

// 文件名与内置标签同名：显式命名，模板里的 <swiper> 才不会被当成自引用。
defineOptions({ name: 'SwiperPage' });

const index = ref(0);
const slides = ['轮播第 1 屏', '轮播第 2 屏', '轮播第 3 屏'];
</script>

<template>
  <view>
    <Panel title="横向轮播" desc="左右滑动切换">
      <!-- 三张的渐变各不相同：用 slide-1/2/3 三个 class，而不是内联 style -->
      <swiper class="swiper" @page-changed="(i: string) => (index = Number(i))">
        <view
          v-for="(s, i) in slides"
          :key="s"
          class="slide"
          :class="`slide-${i + 1}`"
        >
          <text class="slide-t">{{ s }}</text>
        </view>
      </swiper>
      <view class="dots">
        <view
          v-for="(s, i) in slides"
          :key="s"
          class="dot"
          :class="{ active: i === index }"
        />
      </view>
      <text class="caption">当前第 {{ index + 1 }} 屏</text>
    </Panel>
  </view>
</template>

<style scoped>
.swiper {
  height: 160px;
}
.slide {
  border-radius: 10px;
  align-items: center;
  justify-content: center;
}
.slide-1 {
  background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
}
.slide-2 {
  background: linear-gradient(135deg, #f6d365 0%, #fda085 100%);
}
.slide-3 {
  background: linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%);
}
.slide-t {
  color: #ffffff;
  font-size: 20px;
  font-weight: 600;
}
.dots {
  flex-direction: row;
  justify-content: center;
  gap: 6px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 4px;
  background-color: #d8d8d8;
}
.dot.active {
  background-color: #007aff;
}
.caption {
  text-align: center;
  font-size: 12px;
  color: #999999;
}
</style>
