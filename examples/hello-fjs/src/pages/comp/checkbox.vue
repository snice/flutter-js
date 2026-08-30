<route>
{"title": "多选框", "tag": "checkbox", "group": "表单组件"}
</route>

<script setup lang="ts">
// checkbox：映射 Checkbox，@change 回派 "1" / "0"。
import { computed, ref } from 'vue';
import Panel from '../../components/Panel.vue';

// 文件名与内置标签同名：显式命名，模板里的 <checkbox> 才不会被当成自引用。
defineOptions({ name: 'CheckboxPage' });

const items = ref([
  { id: 1, name: 'view / text / image', checked: true },
  { id: 2, name: 'button / input', checked: false },
  { id: 3, name: 'switch / slider', checked: false },
]);

const checkedCount = computed(() => items.value.filter((i) => i.checked).length);

function setChecked(id: number, on: boolean) {
  items.value = items.value.map((i) => (i.id === id ? { ...i, checked: on } : i));
}
function toggleAll() {
  const on = checkedCount.value !== items.value.length;
  items.value = items.value.map((i) => ({ ...i, checked: on }));
}
</script>

<template>
  <view>
    <Panel title="多选" :desc="`已选 ${checkedCount} / ${items.length}`">
      <view v-for="item in items" :key="item.id" class="row">
        <checkbox :value="item.checked" @change="(v: string) => setChecked(item.id, v === '1')" />
        <text class="name">{{ item.name }}</text>
      </view>
      <button class="btn" @tap="toggleAll">全选 / 全不选</button>
    </Panel>
  </view>
</template>

<style scoped>
.row {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}
.name {
  flex-grow: 1;
  font-size: 15px;
}
.btn {
  border-radius: 8px;
}
</style>
