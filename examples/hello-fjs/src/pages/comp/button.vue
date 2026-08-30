<route>
{"title": "按钮", "tag": "button", "group": "表单组件"}
</route>

<script setup lang="ts">
// button：映射 OutlinedButton，文字取子 text 节点。
import { ref } from 'vue';
import { toast } from 'fjs';
import Panel from '../../components/Panel.vue';

// 文件名与内置标签同名：显式命名，模板里的 <button> 才不会被当成自引用。
defineOptions({ name: 'ButtonPage' });

const taps = ref(0);
</script>

<template>
  <view>
    <Panel title="点击事件" desc="@tap 与 @click 等价">
      <button @tap="taps++">点我 +1</button>
      <text class="hint">已点击 {{ taps }} 次</text>
    </Panel>

    <Panel title="不同配色" desc="按钮外观由 style 决定">
      <button class="btn primary" @tap="() => toast('主要按钮')">主要按钮</button>
      <button class="btn success" @tap="() => toast('成功')">成功</button>
      <button class="btn danger" @tap="() => toast('警告')">警告</button>
      <button class="btn ghost" @tap="() => toast('次要按钮')">次要按钮</button>
    </Panel>

    <Panel title="行内按钮">
      <view class="row">
        <view class="col">
          <button class="btn" @tap="() => toast('取消')">取消</button>
        </view>
        <view class="col">
          <button class="btn primary" @tap="() => toast('确定')">确定</button>
        </view>
      </view>
    </Panel>

    <Panel title="长按">
      <view class="press" @long-press="() => toast('长按触发 onLongPress')">
        <text class="press-t">长按这块区域</text>
      </view>
    </Panel>
  </view>
</template>

<style scoped>
.hint {
  text-align: center;
  color: #666666;
}
.btn {
  border-radius: 8px;
}
.primary {
  background-color: #007aff;
  color: #ffffff;
}
.success {
  background-color: #4cd964;
  color: #ffffff;
}
.danger {
  background-color: #dd524d;
  color: #ffffff;
}
.ghost {
  border-color: #007aff;
  color: #007aff;
}
.row {
  flex-direction: row;
  gap: 12px;
}
.col {
  flex-grow: 1;
}
.press {
  height: 48px;
  border-radius: 8px;
  background-color: #f4f5f7;
  align-items: center;
  justify-content: center;
}
.press-t {
  color: #666666;
}
</style>
