<route>
{"title": "吸顶布局", "tag": "sticky-header", "group": "视图容器"}
</route>

<script setup lang="ts">
// sticky-header / sticky-section（specs/052）：分组吸顶。三端一份源码：
// web 是 CSS position: sticky，Flutter 是 PinnedHeaderSliver +
// SliverMainAxisGroup，小程序 skyline 是原生组件（webview 渲染器降级成
// view + position: sticky）。吸顶组件必须是 type="custom" 的 scroll-view
// 的直接子节点——三端都按这个结构编译。
import { ref } from 'vue';
import Panel from '@/components/Panel.vue';

defineOptions({ name: 'StickyPage' });

const groups = [
  { name: 'A · 500px 量级', items: ['阿呆', '阿飞', '阿宽'] },
  { name: 'B · 四行', items: ['小白', '小黑', '小蓝', '小紫'] },
  { name: 'C · 两行', items: ['陈晨', '程成'] },
  { name: 'D · 五行', items: ['大壮', '大成', '大洋', '大海', '大山'] },
];

// @stickontopchange：吸顶状态翻转才派一次，载荷是 JSON 字符串（三端一致）
const flips = ref<string[]>([]);
function onStick(detail: string) {
  flips.value.unshift(detail);
  flips.value = flips.value.slice(0, 4);
}
</script>

<template>
  <view>
    <Panel title="分组吸顶" desc="sticky-section + sticky-header（type=custom）">
      <scroll-view type="custom" class="group-scroll" scroll-y>
        <sticky-section v-for="g in groups" :key="g.name">
          <sticky-header @stickontopchange="onStick">
            <view class="cap">
              <text class="cap-t">{{ g.name }}</text>
            </view>
          </sticky-header>
          <view v-for="it in g.items" :key="it" class="row">
            <text>{{ it }}</text>
          </view>
        </sticky-section>
      </scroll-view>
      <view class="event">
        <text class="event-t">{{ flips.length ? flips.join('  ·  ') : '滚一下，看组头的吸顶/离场翻转' }}</text>
      </view>
    </Panel>

    <Panel title="整段吸顶 + offset-top" desc="sticky-header 直接做 scroll-view 子节点，吸住不随组离场">
      <scroll-view type="custom" class="group-scroll" scroll-y>
        <sticky-header :offset-top="8">
          <view class="bar">
            <text class="cap-t">工具条（offset-top: 8）</text>
          </view>
        </sticky-header>
        <view v-for="n in 24" :key="n" class="row">
          <text>第 {{ n }} 行</text>
        </view>
      </scroll-view>
    </Panel>

    <Panel title="CSS position: sticky" desc="web 与小程序 webview 渲染器原生生效；Flutter 端请用上面的组件">
      <scroll-view class="v-scroll" scroll-y>
        <view class="css-sticky">
          <text class="cap-t">粘住我（position: sticky）</text>
        </view>
        <view v-for="n in 16" :key="n" class="row">
          <text>第 {{ n }} 行</text>
        </view>
      </scroll-view>
    </Panel>
  </view>
</template>

<style scoped>
.group-scroll {
  /* skyline 要求确定高度；sticky 语义也需要自己的滚动容器 */
  height: 240px;
  background-color: #f4f5f7;
  border-radius: 8px;
}
.cap {
  background-color: #007aff;
  padding: 8px 10px;
}
.bar {
  background-color: #34c759;
  padding: 8px 10px;
  border-radius: 6px;
}
.cap-t {
  color: #ffffff;
  font-size: 13px;
  font-weight: 600;
}
.row {
  background-color: #ffffff;
  border-radius: 6px;
  padding: 10px;
  margin: 8px 8px 0;
}
.css-sticky {
  position: sticky;
  top: 0px;
  background-color: #ff9500;
  padding: 8px 10px;
}
.event {
  margin-top: 8px;
}
.event-t {
  font-size: 12px;
  color: #666666;
}
.v-scroll {
  height: 180px;
  background-color: #f4f5f7;
  border-radius: 8px;
}
</style>
