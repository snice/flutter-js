<route>
{"title": "输入框", "tag": "input", "group": "表单组件"}
</route>

<script setup lang="ts">
// input：映射 TextField。fjs 没有 v-model，用 :value + @input 自己回写。
import { ref } from 'vue';
import { toast } from 'fjs';
import Panel from '@/components/Panel.vue';

// 文件名与内置标签同名：显式命名，模板里的 <input> 才不会被当成自引用。
defineOptions({ name: 'InputPage' });

const name = ref('');
const password = ref('');
const memo = ref('');
const submitted = ref('');
</script>

<template>
  <view>
    <Panel title="基础输入" desc=":value + @input（v-model 暂不支持）">
      <input
        :value="name"
        placeholder="请输入昵称"
        class="field"
        @input="(t: string) => (name = t)"
        @submit="(t: string) => (submitted = t)"
      />
      <text class="hint">输入内容：{{ name || '（空）' }}</text>
      <text v-if="submitted" class="hint ok">已提交：{{ submitted }}</text>
    </Panel>

    <Panel title="密码框" desc="secure">
      <input
        :value="password"
        placeholder="请输入密码"
        :secure="true"
        class="field"
        @input="(t: string) => (password = t)"
      />
      <text class="hint">长度：{{ password.length }}</text>
    </Panel>

    <Panel title="多行输入" desc="multiline">
      <input
        :value="memo"
        placeholder="说点什么…"
        :multiline="true"
        class="field memo"
        @input="(t: string) => (memo = t)"
      />
    </Panel>

    <Panel title="表单行">
      <view class="row">
        <text class="row-label">手机号</text>
        <input
          :value="name"
          placeholder="11 位手机号"
          class="row-field"
          @input="(t: string) => (name = t)"
        />
      </view>
      <button class="submit" @tap="() => toast(name ? '提交：' + name : '请先填写')">提交</button>
    </Panel>
  </view>
</template>

<style scoped>
.field {
  border: 1px solid #e5e5e5;
  border-radius: 8px;
  padding: 4px 10px;
}
.memo {
  height: 88px;
  padding: 8px;
}
.hint {
  font-size: 12px;
  color: #999999;
}
.ok {
  color: #007aff;
}
.row {
  flex-direction: row;
  align-items: center;
  gap: 12px;
}
.row-label {
  width: 64px;
  font-size: 14px;
  color: #666666;
}
.row-field {
  flex-grow: 1;
}
.submit {
  background-color: #007aff;
  color: #ffffff;
  border-radius: 8px;
}
</style>
