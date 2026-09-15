<route>
{"title": "伪类", "group": "样式演示", "desc": ":first-child / :last-child / :hover，两端同源"}
</route>

<script setup lang="ts">
// 结构伪类与 hover 的演示页（spec 040）。
//
// :first-child / :last-child 由 JS 侧 CSS 引擎按元素树计算，随普通样式
// 下发——兄弟增删后两端都会即时重算；:hover 由引擎多算一份样式走 op 12
// 下发，App 端桌面（macOS 等）由 MouseRegion 就地切换，移动端不触发，
// web 端是浏览器原生。列表的两种混排写法专门各放一组：裸文字在 web 上
// 是文本节点不算元素，fjs 引擎按同样的口径跳过它；显式 <text> 两端都
// 是元素，照常参与判定。
import { ref } from 'vue';
import Panel from '@/components/Panel.vue';

let nextId = 5;
const items = ref([
  { id: 1, text: '第一行' },
  { id: 2, text: '第二行' },
  { id: 3, text: '第三行' },
  { id: 4, text: '最后一行' },
]);

function removeItem(): void {
  if (items.value.length > 1) items.value.pop();
}
function addItem(): void {
  items.value.push({ id: nextId++, text: `第 ${items.value.length + 1} 行` });
}
</script>

<template>
  <view>
    <Panel title="列表收尾" desc=":first-child 顶格、:last-child 去分隔线；增删一行，两端即时重算">
      <view class="list">
        <view v-for="it in items" :key="it.id" class="row">
          <text class="row-text">{{ it.text }}</text>
        </view>
      </view>
      <view class="row gap">
        <button size="mini" type="primary" @tap="addItem">加一行</button>
        <button size="mini" @tap="removeItem">删一行</button>
      </view>
      <text class="hint">
        最后一行的分隔线随增删即时消失/恢复；第一行永远没有上边距——页面代码
        没有写任何 index 判断。
      </text>
    </Panel>

    <Panel title="裸文字 vs 显式 text" desc="两种混排下，绿色块是否算「第一个元素」两端必须一致">
      <text class="hint">
        左组：view 里的「备注：」是裸文字（web 上是文本节点），它不算元素，
        绿块自己是 :first-child。右组：显式写的 text 标签是真元素，绿块不是。
      </text>
      <view class="row gap">
        <view class="mix">备注：<view class="chip first">
            <text class="chip-text">first-child 生效</text>
          </view>
        </view>
        <view class="mix">
          <text class="mix-label">备注：</text>
          <view class="chip">
            <text class="chip-text">不是第一个</text>
          </view>
        </view>
      </view>
    </Panel>

    <Panel title="单边边框" desc="border-bottom / border-top 各边单独声明，两端同源（spec 041）">
      <view class="srow">每行一条下分隔线……</view>
      <view class="srow">……最后一行用 :last-child 关掉</view>
      <view class="srow srow-last">border-bottom: none 收尾</view>
      <view class="accent">border-top 强调条 + 圆角（App 走自绘 painter）</view>
      <text class="hint">
        行分隔线、卡片强调条都可以直接写单边边框；非一致边配圆角在 App 端由
        painter 按边描画。
      </text>
    </Panel>

    <Panel title="悬停与按压" desc=":hover 桌面端鼠标 / 桌面浏览器；:active 按下；同时命中时按压优先">
      <view class="row gap">
        <view class="hover-box">
          <text class="hover-text">hover 我</text>
        </view>
        <view class="hover-box press">
          <text class="hover-text">hover + active</text>
        </view>
      </view>
      <text class="hint">
        桌面上悬停变灰、按下变蓝，松手回灰；移动端和移动浏览器一样没有悬停态。
      </text>
    </Panel>
  </view>
</template>

<style scoped>
.hint {
  font-size: 12px;
  color: var(--fjs-faint);
  line-height: 18px;
}
.row {
  flex-direction: row;
}
.gap {
  gap: 8px;
  flex-wrap: wrap;
}
.list {
  background-color: var(--fjs-card);
  border-radius: 10px;
}
.row-text {
  font-size: 14px;
  color: var(--fjs-text);
}
.list .row {
  padding: 12 16;
  border-bottom: 1px solid #eeeeee;
}
.list .row:first-child {
  /* 头行淡灰，演示 :first-child 确实只命中第一行 */
  background-color: #fafafa;
}
.list .row:last-child {
  border-bottom: none;
}
.mix {
  flex-direction: row;
  align-items: center;
  gap: 6px;
}
.mix-label {
  font-size: 13px;
  color: var(--fjs-muted);
}
.chip {
  background-color: #f5f5f5;
  border-radius: 6px;
  padding: 4 8;
}
.chip.first {
  background-color: #e8f7e8;
}
.chip-text {
  font-size: 12px;
  color: #333333;
}
.hover-box {
  background-color: #ffffff;
  border: 1px solid #dddddd;
  border-radius: 8px;
  padding: 10 16;
}
.hover-box:hover {
  background-color: #f2f2f2;
}
.hover-box.press:active {
  background-color: #eef4ff;
}
.hover-text {
  font-size: 13px;
  color: #333333;
}
.srow {
  padding: 10 12;
  border-bottom: 1px solid #eeeeee;
}
.mixrow {
  flex-direction: row;
  align-items: center;
  gap: 6px;
}
.mbb {
  border-bottom: 1px solid #ff0000;
}
.stext {
  font-size: 13px;
  color: #333333;
}
.srow-last {
  border-bottom: none;
}
.accent {
  margin-top: 10px;
  padding: 10 12;
  border-top: 2px solid #007aff;
  border-bottom: 1px solid #eeeeee;
  border-radius: 8px;
  font-size: 13px;
  color: #333333;
}
</style>
