<route>
{"title": "单选与分组", "tag": "radio", "group": "表单组件"}
</route>

<script setup lang="ts">
// radio / radio-group / checkbox-group / label。
// 组只管互斥与收集：@change 的载荷两端逐字节相同 —— radio-group 给选中项的
// name，checkbox-group 给 name 的 JSON 数组串。
import { ref } from 'vue';
import Panel from '@/components/Panel.vue';

// 文件名与内置标签同名：显式命名，模板里的 <radio> 才不会被当成自引用。
defineOptions({ name: 'RadioPage' });

const plans = [
  { id: 'free', text: '免费版' },
  { id: 'pro', text: '专业版' },
  { id: 'team', text: '团队版' },
];
const plan = ref('free');

const tags = [
  { id: 'flutter', text: 'Flutter' },
  { id: 'vue', text: 'Vue 3' },
  { id: 'quickjs', text: 'QuickJS' },
];
const picked = ref<string[]>(['vue']);

const agree = ref(false);
</script>

<template>
  <view>
    <Panel title="单选" :desc="`radio-group 回派：${plan}`">
      <radio-group class="group" @change="(v: string) => (plan = v)">
        <label v-for="item in plans" :key="item.id" class="row">
          <radio :name="item.id" :value="plan === item.id" />
          <text class="name">{{ item.text }}</text>
        </label>
      </radio-group>
    </Panel>

    <Panel title="多选" :desc="`checkbox-group 回派：${JSON.stringify(picked)}`">
      <checkbox-group
        class="group"
        @change="(v: string) => (picked = JSON.parse(v))"
      >
        <label v-for="item in tags" :key="item.id" class="row">
          <checkbox :name="item.id" :value="picked.includes(item.id)" />
          <text class="name">{{ item.text }}</text>
        </label>
      </checkbox-group>
    </Panel>

    <Panel title="label" desc="点整行都能切换；for 指名道姓">
      <label class="row" for="agree">
        <text class="name">点这行文字也能勾选</text>
        <checkbox id="agree" :value="agree" @change="(v: string) => (agree = v === '1')" />
      </label>
      <text class="hint">当前：{{ agree ? '已同意' : '未同意' }}</text>
    </Panel>
  </view>
</template>

<style scoped>
.group {
  gap: 12px;
}
.row {
  flex-direction: row;
  align-items: center;
  align-self: stretch;
  width: 100%;
  margin: 0;
  gap: 8px;
}
.name {
  flex-grow: 1;
  font-size: 15px;
  color: var(--fjs-title);
}
.hint {
  font-size: 13px;
  color: var(--fjs-muted);
}
</style>
