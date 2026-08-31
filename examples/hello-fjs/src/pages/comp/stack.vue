<route>
{"title": "层叠布局", "tag": "stack", "group": "视图容器"}
</route>

<script setup lang="ts">
// stack：映射 Stack，子节点用 position: 'absolute' + top/left/right/bottom 定位。
import Panel from '@/components/Panel.vue';

// 文件名与内置标签同名：显式命名，模板里的 <stack> 才不会被当成自引用。
defineOptions({ name: 'StackPage' });
</script>

<template>
  <view>
    <Panel title="层叠定位" desc="position: absolute + top / right / bottom / left">
      <!-- 背景直接画在 stack 自己身上：Stack 的非定位子节点按自身尺寸，
           一个空 view 的宽度会塌成 0 -->
      <stack class="poster">
        <text class="poster-title">海报标题</text>
        <view class="poster-tag"><text class="poster-tag-t">HOT</text></view>
      </stack>
    </Panel>

    <Panel title="角标" desc="常见的头像 + 未读红点">
      <stack class="badge-box">
        <view class="badge-avatar"><text class="badge-icon">✉</text></view>
        <view class="badge"><text class="badge-t">9</text></view>
      </stack>
    </Panel>
  </view>
</template>

<style scoped>
.poster {
  height: 160px;
  border-radius: 10px;
  background: linear-gradient(180deg, #4facfe 0%, #00f2fe 100%);
}
.poster-title {
  position: absolute;
  left: 16px;
  bottom: 16px;
  color: #ffffff;
  font-size: 18px;
  font-weight: 600;
}
.poster-tag {
  position: absolute;
  /* 列默认 stretch：不加这句，没有显式宽度的绝对定位块会被拉开 */
  align-items: flex-start;
  top: 12px;
  right: 12px;
  background-color: #dd524d;
  border-radius: 10px;
  padding: 2px 8px;
}
.poster-tag-t {
  color: #ffffff;
  font-size: 11px;
}
.badge-box {
  width: 56px;
  height: 56px;
}
.badge-avatar {
  width: 56px;
  height: 56px;
  border-radius: 12px;
  background-color: #eef4ff;
  align-items: center;
  justify-content: center;
}
.badge-icon {
  color: #007aff;
  font-size: 20px;
}
.badge {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 20px;
  height: 20px;
  border-radius: 10px;
  background-color: #dd524d;
  align-items: center;
  justify-content: center;
}
.badge-t {
  color: #ffffff;
  font-size: 11px;
}
</style>
