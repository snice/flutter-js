<route>
{"title": "表单", "tag": "form", "group": "表单组件"}
</route>

<script setup lang="ts">
// form + button 的六种形态 + input 的 focus / blur / maxlength。
// form 只负责收集与提交：@submit 的载荷是 {name: value} 的 JSON 串，
// 值取控件当前态（未受控的 input 也算），@reset 只发事件，回滚由页面做。
import { ref } from 'vue';
import Panel from '@/components/Panel.vue';

defineOptions({ name: 'FormPage' });

const nickname = ref('');
const count = ref('');
const agree = ref(false);
const focused = ref(false);
const submitted = ref('');

function onSubmit(payload: string) {
  submitted.value = payload;
}
// @reset 只发事件：值归页面所有，回滚在这里做。没绑值的控件页面清不掉，
// 所以要进表单的字段都该绑上。
function onReset() {
  nickname.value = '';
  count.value = '';
  agree.value = false;
  submitted.value = '';
}
</script>

<template>
  <view>
    <form @submit="onSubmit" @reset="onReset">
      <Panel title="字段" desc="带 name 的控件都会进提交载荷">
        <label class="row" for="nickname">
          <text class="k">昵称</text>
          <input
            id="nickname"
            name="nickname"
            class="v"
            :class="{ focused }"
            :value="nickname"
            :maxlength="10"
            placeholder="最多 10 个字"
            @input="(t: string) => (nickname = t)"
            @focus="() => (focused = true)"
            @blur="() => (focused = false)"
          />
        </label>
        <label class="row">
          <text class="k">接收通知</text>
          <switch
            name="agree"
            :value="agree"
            @change="(v: string) => (agree = v === '1')"
          />
        </label>
        <label class="row" for="count">
          <text class="k">数量</text>
          <input
            id="count"
            name="count"
            class="v"
            keyboard="number"
            placeholder="数字键盘"
            :value="count"
            @input="(t: string) => (count = t)"
          />
        </label>
      </Panel>

      <Panel title="提交" :desc="submitted || '还没提交，重置由页面回滚值'">
        <button type="primary" form-type="submit">提交</button>
        <button form-type="reset">重置</button>
      </Panel>
    </form>

    <Panel title="button 形态" desc="type / plain / size / disabled / loading">
      <button type="primary">主要操作</button>
      <button type="warn">警告操作</button>
      <button type="primary" plain>主要描边</button>
      <button type="warn" plain>警告描边</button>
      <button size="mini">小按钮</button>
      <button type="primary" disabled>不可用</button>
      <button type="primary" loading>提交中</button>
    </Panel>
  </view>
</template>

<style scoped>
.row {
  flex-direction: row;
  align-items: center;
  align-self: stretch;
  width: 100%;
  margin: 0;
  gap: 12px;
}
.k {
  width: 72px;
  font-size: 15px;
  color: var(--fjs-title);
}
.v {
  flex-grow: 1;
  border-bottom: 1px solid var(--fjs-border);
  padding: 8px 0;
}
.v.focused {
  border-bottom-color: #007aff;
}
</style>
