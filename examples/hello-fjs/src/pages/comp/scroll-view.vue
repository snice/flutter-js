<route>
{"title": "可滚动视图", "tag": "scroll-view", "group": "视图容器"}
</route>

<script setup lang="ts">
// scroll-view：映射 SingleChildScrollView。方向用 scroll-x / scroll-y，
// 也兼容老的样式键 direction: 'horizontal'（prop 优先）。
import { ref } from 'vue';
import Panel from '@/components/Panel.vue';

// 文件名与内置标签同名：显式命名，模板里的 <scroll-view> 才不会被当成自引用。
defineOptions({ name: 'ScrollViewPage' });

// 触底加载：@scrolltolower 进入阈值区才派一次，离开再回来才重派
const rows = ref(20);
const loads = ref(0);
function loadMore() {
  loads.value += 1;
  rows.value += 10;
}

// 跳到某一行：scroll-into-view 认子节点的 id
const target = ref('');
function jumpTo(n: number) {
  target.value = `row-${n}`;
}

// @scroll 的六字段载荷，两端逐字节相同
const detail = ref('');
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
      <scroll-view class="v-scroll" scroll-y>
        <view v-for="n in 20" :key="n" class="line">
          <text>第 {{ n }} 行</text>
        </view>
      </scroll-view>
    </Panel>

    <Panel
      title="触底加载"
      :desc="`已加载 ${rows} 行，触发 ${loads} 次（进入阈值区只派一次）`"
    >
      <scroll-view
        class="v-scroll"
        scroll-y
        :lower-threshold="60"
        @scrolltolower="loadMore"
      >
        <view v-for="n in rows" :key="n" class="line">
          <text>第 {{ n }} 行</text>
        </view>
      </scroll-view>
    </Panel>

    <Panel title="跳到某一行" desc="scroll-into-view + scroll-with-animation">
      <view class="row">
        <button class="mini" size="mini" @tap="jumpTo(3)">第 3 行</button>
        <button class="mini" size="mini" @tap="jumpTo(12)">第 12 行</button>
        <button class="mini" size="mini" @tap="jumpTo(19)">第 19 行</button>
      </view>
      <scroll-view
        class="v-scroll"
        scroll-y
        scroll-with-animation
        :scroll-into-view="target"
      >
        <view v-for="n in 20" :key="n" :id="`row-${n}`" class="line">
          <text>第 {{ n }} 行</text>
        </view>
      </scroll-view>
    </Panel>

    <Panel title="@scroll 载荷" :desc="detail || '滚一下看看'">
      <scroll-view
        class="v-scroll"
        scroll-y
        @scroll="(d: string) => (detail = d)"
      >
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
.row {
  flex-direction: row;
  gap: 8px;
  margin-bottom: 8px;
}
.mini {
  border-radius: 6px;
}
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
