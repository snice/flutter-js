<route>
{"title": "过渡演示", "group": "样式演示", "desc": "transition：背景渐变 / transform 缩放 / opacity，两端同源"}
</route>

<script setup lang="ts">
// transition 演示页（spec 045）。
//
// 可动画属性：background-color / transform / opacity / width / height
// （App 端 decoration 层逐帧插值，web 端浏览器原生）。其余属性（color /
// border）App 端瞬时跳变，是登记过的两端差异；@keyframes 另立 spec。
// 对拍：按住「按住缩小」看 :active 缩放渐变；点「点我变色」看背景色
// 0.3s 渐变；hover（桌面/悬停）看淡入。
import { ref } from 'vue';
import Panel from '@/components/Panel.vue';

const on = ref(false);
</script>

<template>
  <view>
    <Panel title="背景渐变" desc="transition: background-color 0.3s —— 点按切换类名，颜色按帧插值，不是瞬时跳变">
      <view class="fade-btn" :class="{ on: on }" @tap="on = !on">{{ on ? '深蓝（点了）' : '绿色（再点）' }}</view>
      <view class="card" :class="{ active: on }">卡片跟随同一状态渐变</view>
    </Panel>

    <Panel title="按压缩放" desc="transition: transform 0.2s + :active —— 按住缩小、松手弹回（transform 过渡为既有能力）">
      <view class="press-btn">按住缩小</view>
    </Panel>

    <Panel title="opacity 淡入" desc="transition: opacity 0.4s + :hover —— 桌面悬停渐显；移动端可用点按上方状态对照">
      <view class="ghost">悬停淡入</view>
    </Panel>

    <Panel title="尺寸过渡" desc="transition: width 0.4s —— 点按变宽/还原。尺寸是布局属性：逐帧重排，与 web 的成本一致，别在大子树上用">
      <view class="size-btn" :class="{ wide: on }" @tap="on = !on">点我变宽</view>
    </Panel>
  </view>
</template>

<style scoped>
.fade-btn {
  background-color: #07c160;
  border-radius: 8;
  padding: 12 16;
  color: #ffffff;
  font-size: 15;
  transition: background-color 0.3s ease;
}
.fade-btn.on {
  background-color: #1c3d78;
}
/* 状态打在同一节点上：tap 切换文字由模板驱动，这里用第二张卡片演示类切换 */
.card {
  margin: 12 0 0;
  padding: 12 16;
  border-radius: 8;
  background-color: #ececec;
  color: #333333;
  font-size: 14;
  transition: background-color 0.3s ease;
}
.card.active {
  background-color: #1c3d78;
  color: #ffffff;
}

.press-btn {
  width: 160px;
  padding: 12 0;
  text-align: center;
  background-color: #dd524d;
  border-radius: 8;
  color: #ffffff;
  font-size: 15;
  transition: transform 0.2s ease;
}
.press-btn:active {
  transform: scale(0.92);
}

.ghost {
  width: 160px;
  padding: 12 0;
  text-align: center;
  background-color: #35383f;
  border-radius: 8;
  color: #ffffff;
  font-size: 15;
  opacity: 0.45;
  transition: opacity 0.4s ease;
}
.ghost:hover {
  opacity: 1;
}

.size-btn {
  width: 140px;
  padding: 12 16;
  background-color: #2f86ff;
  border-radius: 8;
  color: #ffffff;
  font-size: 15;
  transition: width 0.4s ease;
}
.size-btn.wide {
  width: 240px;
}
</style>
