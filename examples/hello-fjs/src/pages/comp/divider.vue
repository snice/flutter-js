<route>
{"title": "分割线", "tag": "divider", "group": "基础内容"}
</route>

<script setup lang="ts">
// divider：映射 Divider，height 控制占位高度，color 控制线色。
import Panel from '../../components/Panel.vue';

// 文件名与内置标签同名：显式命名，模板里的 <divider> 才不会被当成自引用。
defineOptions({ name: 'DividerPage' });
</script>

<template>
  <view>
    <Panel title="默认分割线">
      <text>上面一段</text>
      <divider />
      <text>下面一段</text>
    </Panel>

    <Panel title="自定义颜色与间距">
      <text>height: 8</text>
      <divider class="tight" />
      <text>color: #007AFF</text>
      <divider class="accent" />
      <text>结束</text>
    </Panel>

    <Panel title="列表分隔">
      <view v-for="n in 3" :key="n">
        <view class="row">
          <text>设置项 {{ n }}</text>
          <text class="chev">›</text>
        </view>
        <divider v-if="n < 3" class="hairline" />
      </view>
    </Panel>
  </view>
</template>

<style scoped>
.tight {
  height: 8px;
}
.accent {
  color: #007aff;
  height: 24px;
}
.row {
  flex-direction: row;
  justify-content: space-between;
  padding: 6px 0;
}
.chev {
  color: #cccccc;
}
.hairline {
  height: 1px;
}
</style>
