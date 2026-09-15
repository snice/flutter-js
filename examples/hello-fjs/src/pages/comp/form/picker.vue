<route>
{"title": "选择器", "tag": "picker", "group": "表单组件"}
</route>

<script setup lang="ts">
// picker：从底部弹起的选择器。四种 mode 的列生成与值换算都在 JS 侧
// （components/picker.ts），弹出的滚轮才是原生控件。
import { ref } from 'vue';
import Panel from '@/components/Panel.vue';

defineOptions({ name: 'PickerPage' });

const fruits = ['苹果', '香蕉', '橙子', '西瓜'];
const fruit = ref(0);

const cities = [
  { code: 'bj', name: '北京' },
  { code: 'sh', name: '上海' },
  { code: 'gz', name: '广州' },
];
const city = ref(1);

const sizes = [
  ['S', 'M', 'L'],
  ['红', '蓝', '黑'],
];
const spec = ref([1, 0]);

const time = ref('09:30');
const date = ref('2026-09-04');
const cancelled = ref(0);
</script>

<template>
  <view>
    <Panel title="普通选择器" desc="mode=selector，@change 载荷是下标串">
      <picker
        mode="selector"
        :range="fruits"
        :value="fruit"
        @change="(v: string) => (fruit = Number(v))"
        @cancel="() => cancelled++"
      >
        <view class="cell">
          <text class="k">水果</text>
          <text class="v">{{ fruits[fruit] }}</text>
        </view>
      </picker>
      <text class="hint">取消了 {{ cancelled }} 次（取消不改值）</text>
    </Panel>

    <Panel title="range-key" desc="对象数组在 JS 侧摊平，Dart 只见字符串">
      <picker
        mode="selector"
        :range="cities"
        range-key="name"
        :value="city"
        @change="(v: string) => (city = Number(v))"
      >
        <view class="cell">
          <text class="k">城市</text>
          <text class="v">{{ cities[city].name }}</text>
        </view>
      </picker>
    </Panel>

    <Panel title="多列选择器" :desc="`mode=multiSelector，载荷 ${JSON.stringify(spec)}`">
      <picker
        mode="multiSelector"
        :range="sizes"
        :value="spec"
        @change="(v: string) => (spec = JSON.parse(v))"
      >
        <view class="cell">
          <text class="k">规格</text>
          <text class="v">{{ sizes[0][spec[0]] }} / {{ sizes[1][spec[1]] }}</text>
        </view>
      </picker>
    </Panel>

    <Panel title="时间与日期" desc="列的生成与范围裁剪都在 JS 侧算">
      <picker
        mode="time"
        :value="time"
        start="09:00"
        end="21:00"
        @change="(v: string) => (time = v)"
      >
        <view class="cell">
          <text class="k">时间</text>
          <text class="v">{{ time }}</text>
        </view>
      </picker>
      <picker
        mode="date"
        :value="date"
        start="2020-01-01"
        end="2030-12-31"
        @change="(v: string) => (date = v)"
      >
        <view class="cell">
          <text class="k">日期</text>
          <text class="v">{{ date }}</text>
        </view>
      </picker>
    </Panel>

    <Panel title="禁用" desc="disabled 时点了不弹">
      <picker mode="selector" :range="fruits" :value="0" disabled>
        <view class="cell">
          <text class="k">不可选</text>
          <text class="v">{{ fruits[0] }}</text>
        </view>
      </picker>
    </Panel>
  </view>
</template>

<style scoped>
.cell {
  flex-direction: row;
  align-items: center;
  align-self: stretch;
  width: 100%;
  padding: 10px 0;
}
.k {
  width: 72px;
  font-size: 15px;
  color: var(--fjs-title);
}
.v {
  flex-grow: 1;
  font-size: 15px;
  color: var(--fjs-primary);
}
.hint {
  font-size: 13px;
  color: var(--fjs-muted);
}
</style>
