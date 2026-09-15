<route>
{"title": "内嵌滚轮", "tag": "picker-view", "group": "表单组件"}
</route>

<script setup lang="ts">
// picker-view：页面里直接摆的滚轮。它是本组唯一下到 Dart 的部分——吸附、
// 惯性和 iOS 触感来自 ListWheelScrollView（宪法 VII）。
import { computed, ref } from 'vue';
import Panel from '@/components/Panel.vue';

defineOptions({ name: 'PickerViewPage' });

const years = Array.from({ length: 11 }, (_, i) => 2020 + i);
const months = Array.from({ length: 12 }, (_, i) => i + 1);
const ymd = ref([6, 8]);

// 联动：省变了，市那一列跟着换。picker-view 在弹层里也能这么用，
// 因为 modal 打开期间内容是活的（spec 008 Q1）。
const provinces = ['北京', '上海', '广东'];
const citiesOf: Record<string, string[]> = {
  北京: ['东城', '西城', '朝阳'],
  上海: ['黄浦', '静安', '徐汇'],
  广东: ['广州', '深圳', '珠海', '佛山'],
};
const region = ref([0, 0]);
const cities = computed(() => citiesOf[provinces[region.value[0]]] ?? []);

function onRegion(payload: string) {
  const next = JSON.parse(payload) as number[];
  // 换省时把市的下标收回到合法范围
  const cityCount = (citiesOf[provinces[next[0]]] ?? []).length;
  region.value = [next[0], Math.min(next[1], Math.max(0, cityCount - 1))];
}
</script>

<template>
  <view>
    <Panel title="年月" :desc="`${years[ymd[0]]} 年 ${months[ymd[1]]} 月`">
      <picker-view
        class="wheel"
        :value="ymd"
        @change="(v: string) => (ymd = JSON.parse(v))"
      >
        <picker-view-column>
          <view v-for="y in years" :key="y" class="item">
            <text>{{ y }} 年</text>
          </view>
        </picker-view-column>
        <picker-view-column>
          <view v-for="m in months" :key="m" class="item">
            <text>{{ m }} 月</text>
          </view>
        </picker-view-column>
      </picker-view>
    </Panel>

    <Panel
      title="联动列"
      :desc="`${provinces[region[0]]} · ${cities[region[1]] ?? '—'}`"
    >
      <picker-view class="wheel" :value="region" @change="onRegion">
        <picker-view-column>
          <view v-for="p in provinces" :key="p" class="item">
            <text>{{ p }}</text>
          </view>
        </picker-view-column>
        <picker-view-column>
          <view v-for="c in cities" :key="c" class="item">
            <text>{{ c }}</text>
          </view>
        </picker-view-column>
      </picker-view>
    </Panel>
  </view>
</template>

<style scoped>
.wheel {
  align-self: stretch;
  width: 100%;
}
.item {
  align-items: center;
  justify-content: center;
  font-size: 16px;
}
</style>
