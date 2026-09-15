<route>
{"title": "滑块", "tag": "slider", "group": "表单组件"}
</route>

<script setup lang="ts">
// slider：映射 Slider，@change 回派数值串（保留两位小数）。
import { ref } from 'vue';
import Panel from '@/components/Panel.vue';

// 文件名与内置标签同名：显式命名，模板里的 <slider> 才不会被当成自引用。
defineOptions({ name: 'SliderPage' });

const volume = ref(40);
const size = ref(16);
</script>

<template>
  <view>
    <Panel title="音量" :desc="`当前 ${Math.round(volume)}`">
      <slider :value="volume" :min="0" :max="100" @change="(v: string) => (volume = Number(v))" />
      <view class="ticks">
        <text class="tick">0</text>
        <text class="tick">100</text>
      </view>
    </Panel>

    <Panel title="联动字号" :desc="`fontSize: ${Math.round(size)}`">
      <slider :value="size" :min="12" :max="32" @change="(v: string) => (size = Number(v))" />
      <!-- 字号跟着滑块走，这类真正动态的值才留在 :style 里 -->
      <text :style="{ fontSize: Math.round(size) }">拖动滑块改变这行字的大小</text>
    </Panel>
  </view>
</template>

<style scoped>
.ticks {
  flex-direction: row;
  justify-content: space-between;
}
.tick {
  font-size: 12px;
  color: #999999;
}
</style>
