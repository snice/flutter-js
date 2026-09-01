import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useCounter = defineStore('counter', () => {
  const count = ref(0);
  const inc = () => count.value++;
  return { count, inc };
});
