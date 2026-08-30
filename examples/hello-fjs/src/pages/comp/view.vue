<route>
{"title": "视图容器与 flex 布局", "tag": "view", "group": "视图容器"}
</route>

<script setup lang="ts">
// view：flex 容器，对应 Flutter 的 Flex + 装饰容器。
import Panel from '../../components/Panel.vue';

// 文件名与内置标签同名：显式命名，模板里的 <view> 才不会被当成自引用。
defineOptions({ name: 'ViewPage' });

const boxes = ['1', '2', '3'];
const justify = ['flex-start', 'center', 'space-between'];
</script>

<template>
  <view>
    <Panel title="横向排列" desc="flexDirection: row + gap">
      <view class="row">
        <view v-for="b in boxes" :key="b" class="box"><text class="box-t">{{ b }}</text></view>
      </view>
    </Panel>

    <Panel title="主轴对齐" desc="justifyContent">
      <view v-for="j in justify" :key="j" class="demo">
        <text class="label">{{ j }}</text>
        <!-- 唯一动态的一项：其余排版都在 .track 里 -->
        <view class="track" :style="{ justifyContent: j }">
          <view class="box" /><view class="box" /><view class="box" />
        </view>
      </view>
    </Panel>

    <Panel title="换行" desc="flexWrap: wrap（映射 Wrap）">
      <view class="wrap">
        <view v-for="n in 8" :key="n" class="chip"><text class="chip-t">tag {{ n }}</text></view>
      </view>
    </Panel>

    <Panel title="装饰" desc="圆角 / 边框 / 阴影 / 渐变">
      <view class="deco bordered"><text>border + radius</text></view>
      <view class="deco shadowed"><text>box-shadow</text></view>
      <view class="deco gradient"><text class="deco-t">linear-gradient</text></view>
    </Panel>
  </view>
</template>

<style scoped>
.row {
  flex-direction: row;
  gap: 8px;
}
.box {
  width: 40px;
  height: 40px;
  border-radius: 6px;
  background-color: #007aff;
  align-items: center;
  justify-content: center;
}
.box-t {
  color: #ffffff;
  font-weight: 600;
}
.demo {
  gap: 6px;
}
.label {
  font-size: 12px;
  color: #999999;
}
.track {
  flex-direction: row;
  gap: 6px;
  background-color: #f4f5f7;
  padding: 6px;
  border-radius: 6px;
}
.wrap {
  flex-direction: row;
  flex-wrap: wrap;
  gap: 8px;
}
.chip {
  /* 列默认 stretch 会把子项拉满整行；靠 flex-start 让它按内容宽度收缩 */
  align-items: flex-start;
  background-color: #eef4ff;
  border-radius: 14px;
  padding: 6px 12px;
}
.chip-t {
  font-size: 12px;
  color: #007aff;
}
.deco {
  height: 56px;
  border-radius: 12px;
  align-items: center;
  justify-content: center;
}
.bordered {
  border: 1px solid #dddddd;
}
.shadowed {
  background-color: #ffffff;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}
.gradient {
  background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
}
.deco-t {
  color: #ffffff;
  font-weight: 600;
}
</style>
