<route>
{"title": "百分比间距与偏移", "group": "样式演示", "desc": "% padding / margin / 定位偏移，参照轴按 CSS"}
</route>

<script setup lang="ts">
// 百分比盒模型间距与定位偏移（spec 044）。
//
// % 不只尺寸属性能用：padding/margin（四边都参照父盒**宽度**，含上下边，
// CSS 就是这样）、relative/absolute 的 left/right（参照宽）、top/bottom
// （参照高）。App 端由 FjsLength 在布局期按约束解析，参照无界（列表、
// scroll-view 纵向）按 CSS 退化为 0；web 是真 CSS 原生。
// 对拍：web 拖窗口宽度，留白随宽度伸缩；App 转屏同看。
import Panel from '@/components/Panel.vue';
</script>

<template>
  <view>
    <Panel title="流式内边距" desc="padding: 0 4% —— 左右留白随父盒宽度伸缩；上下边按 CSS 也参照宽度">
      <view class="flow-card">
        <view class="flow-inner">
          <text>内容</text>
        </view>
      </view>
    </Panel>

    <Panel title="% 外边距" desc="margin: 12 5% —— 左右 5% 流式留白，中间色块宽度跟着变">
      <view class="margin-row">
        <view class="margin-box" />
      </view>
    </Panel>

    <Panel title="relative 平移" desc="left: 50% —— 涂色块向右平移半个父盒宽，布局槽位不动（右边的灰色块不移位）">
      <view class="shift-row">
        <view class="shift-box" />
        <view class="shift-next" />
      </view>
    </Panel>

    <Panel title="absolute 居中" desc="top: 50% / left: 50% —— 遮罩块起点在父盒中心；top 参照高、left 参照宽">
      <view class="overlay-box">
        <view class="overlay-dot" />
      </view>
    </Panel>
  </view>
</template>

<style scoped>
.flow-card {
  background-color: #ececec;
  border-radius: 8;
}
.flow-inner {
  padding: 8 4%;
  background-color: #35383f;
  border-radius: 6;
  color: white;
}

.margin-row {
  background-color: #ececec;
  border-radius: 8;
  padding: 8 0;
}
.margin-box {
  margin: 0 5%;
  height: 28;
  background-color: #35383f;
  border-radius: 6;
}

.shift-row {
  background-color: #ececec;
  border-radius: 8;
  padding: 8 0;
  flex-direction: row;
}
.shift-box {
  width: 40;
  height: 28;
  margin-left: 4%;
  background-color: #dd524d;
  border-radius: 6;
  position: relative;
  left: 50%;
}
.shift-next {
  width: 40;
  height: 28;
  background-color: #cccccc;
  border-radius: 6;
}

.overlay-box {
  height: 96;
  background-color: #ececec;
  border-radius: 8;
  position: relative;
}
.overlay-dot {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 24;
  height: 24;
  background-color: #dd524d;
  border-radius: 6;
}
</style>
