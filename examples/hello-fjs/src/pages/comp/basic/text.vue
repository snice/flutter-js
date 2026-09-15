<route>
{"title": "文本", "tag": "text", "group": "基础内容"}
</route>

<script setup lang="ts">
// text：映射 Flutter Text，样式沿组件树继承（同 CSS）。
import Panel from '@/components/Panel.vue';

// 文件名与内置标签同名：显式命名，模板里的 <text> 才不会被当成自引用。
defineOptions({ name: 'TextPage' });
</script>

<template>
  <view>
    <Panel title="字号与字重">
      <text class="lead">22px / 700</text>
      <text class="body">17px / normal</text>
      <text class="muted">13px / 次要信息</text>
    </Panel>

    <Panel title="样式">
      <text class="italic">italic 斜体</text>
      <text class="underline">underline 下划线</text>
      <text class="strike">line-through 删除线</text>
      <text class="spaced">letterSpacing: 2</text>
      <text class="upper">text-transform uppercase</text>
    </Panel>

    <Panel title="对齐与截断">
      <text class="centered">居中文本</text>
      <text class="clamp">
        maxLines + ellipsis：这是一段很长的说明文字，用来演示多行截断的效果，超出两行之后会以省略号结尾，不会把版面撑开。
      </text>
      <text class="single">
        单行不换行：这一行同样很长很长很长很长很长很长很长很长。
      </text>
    </Panel>

    <Panel title="继承" desc="父节点上的 color / fontSize 会向下继承">
      <view class="inherit">
        <text>子节点未声明颜色</text>
        <text>同样是红色 15px</text>
      </view>
    </Panel>
  </view>
</template>

<style scoped>
.lead {
  font-size: 22px;
  font-weight: 700;
}
.body {
  font-size: 17px;
}
.muted {
  font-size: 13px;
  color: #999999;
}
.italic {
  font-style: italic;
}
.underline {
  text-decoration: underline;
  color: #007aff;
}
.strike {
  text-decoration: line-through;
  color: #999999;
}
.spaced {
  letter-spacing: 2px;
}
.upper {
  text-transform: uppercase;
}
.centered {
  text-align: center;
  background-color: #f4f5f7;
  padding: 8px;
}
.clamp {
  max-lines: 2;
  overflow: ellipsis;
  line-height: 1.5;
}
.single {
  white-space: nowrap;
  overflow: ellipsis;
}
.inherit {
  color: #dd524d;
  font-size: 15px;
}
</style>
