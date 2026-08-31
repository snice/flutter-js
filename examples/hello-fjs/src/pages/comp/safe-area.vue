<route>
{"title": "安全区", "tag": "safe-area", "group": "视图容器"}
</route>

<script setup lang="ts">
// safe-area：映射 SafeArea，自动避开刘海 / home indicator。
import Panel from '@/components/Panel.vue';

// 文件名与内置标签同名：显式命名，模板里的 <safe-area> 才不会被当成自引用。
defineOptions({ name: 'SafeAreaPage' });
</script>

<template>
  <view>
    <Panel title="说明">
      <text class="note">safe-area 会按当前设备的安全区插入内边距。本示例的整个外壳（导航栏 + 内容 + tabBar）就包在一个 safe-area 里，所以在刘海屏上不会被状态栏和 home indicator 遮挡。</text>
    </Panel>

    <Panel title="嵌套使用">
      <safe-area>
        <view class="box">
          <text class="box-t">这块内容被 safe-area 包着</text>
        </view>
      </safe-area>
    </Panel>
  </view>
</template>

<style scoped>
.note {
  line-height: 1.6;
  color: #666666;
}
.box {
  background-color: #eef4ff;
  border-radius: 8px;
  padding: 16px;
  align-items: center;
}
.box-t {
  color: #007aff;
}
</style>
