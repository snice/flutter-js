<route>
{"title": "多行输入", "tag": "textarea", "group": "表单组件"}
</route>

<script setup lang="ts">
// textarea：JS 组件，渲染成 <input multiline>。这一页把 auto-height、字数上限、
// @linechange 和 confirm-type 都做成可操作的回归项。
import { computed, ref } from 'vue';
import { toast } from 'fjs';
import Panel from '@/components/Panel.vue';

// 文件名与内置标签同名：显式命名，模板里的 <textarea> 才不会被当成自引用。
defineOptions({ name: 'TextareaPage' });

const note = ref('');
const limited = ref('');
const autoHeight = ref(true);
const lines = ref(1);
const lineHeight = ref(0);

const confirmTypes = ['return', 'send', 'search', 'next', 'go', 'done'] as const;
const confirmType = ref<(typeof confirmTypes)[number]>('send');
const confirmed = ref('');

const focused = ref(false);
// 提交载荷显示在页面上而不是 toast：toast 一闪就没，回归时看不到
const submitted = ref('');

const remaining = computed(() => 140 - limited.value.length);

function onLineChange(payload: string) {
  const detail = JSON.parse(payload) as { height: number; lineCount: number };
  lines.value = detail.lineCount;
  lineHeight.value = detail.height;
}
</script>

<template>
  <view>
    <Panel
      title="auto-height 与 @linechange"
      :desc="`${lines} 行，内容高 ${lineHeight}px`"
    >
      <textarea
        :value="note"
        :auto-height="autoHeight"
        placeholder="多敲几行，看盒子是长高还是内部滚动"
        placeholder-style="color: #c0c0c0"
        :maxlength="-1"
        class="area"
        :class="{ fixed: !autoHeight }"
        @input="(t: string) => (note = t)"
        @linechange="onLineChange"
      />
      <view class="row">
        <button class="mini" size="mini" @tap="autoHeight = !autoHeight">
          {{ autoHeight ? '关掉 auto-height' : '打开 auto-height' }}
        </button>
      </view>
      <text class="hint">
        关掉之后高度由样式决定（这里是 90px），文字超出就在框里滚动。
      </text>
    </Panel>

    <Panel title="字数上限" :desc="`默认 140，还能输入 ${remaining} 字`">
      <textarea
        :value="limited"
        placeholder="不写 maxlength 就是 140，超出直接截断"
        class="area fixed"
        @input="(t: string) => (limited = t)"
      />
      <text class="hint">{{ limited.length }}/140</text>
    </Panel>

    <Panel title="confirm-type" :desc="`当前：${confirmType}`">
      <view class="row wrap">
        <button
          v-for="item in confirmTypes"
          :key="item"
          size="mini"
          class="mini"
          :class="{ selected: item === confirmType }"
          @tap="confirmType = item"
        >
          {{ item }}
        </button>
      </view>
      <textarea
        :confirm-type="confirmType"
        placeholder="return 时回车换行；其余按键派 @confirm"
        class="area fixed"
        @confirm="(t: string) => ((confirmed = t), toast(`confirm: ${t}`))"
      />
      <text class="hint">最近一次 @confirm：{{ confirmed || '（还没有）' }}</text>
    </Panel>

    <Panel title="受控焦点" :desc="focused ? 'focus = true' : 'focus = false'">
      <textarea
        :focus="focused"
        placeholder="点按钮抢焦点；点走之后按钮再点一次才会回来"
        class="area fixed"
        @focus="() => (focused = true)"
        @blur="() => (focused = false)"
      />
      <view class="row">
        <button class="mini" size="mini" @tap="focused = true">聚焦</button>
        <button class="mini" size="mini" @tap="focused = false">失焦</button>
      </view>
    </Panel>

    <Panel title="在表单里" desc="和 input 一样带 name 就能被 @submit 收上去">
      <form @submit="(v: string) => (submitted = v)">
        <textarea name="memo" placeholder="备注" class="area fixed" />
        <button form-type="submit" type="primary" class="submit">提交</button>
      </form>
      <text class="hint">@submit：{{ submitted || '（还没提交）' }}</text>
    </Panel>
  </view>
</template>

<style scoped>
.area {
  background-color: #f7f7f7;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 14px;
}
.area.fixed {
  height: 90px;
}
.row {
  flex-direction: row;
  gap: 8px;
  margin-top: 8px;
}
.row.wrap {
  flex-wrap: wrap;
}
.mini {
  border-radius: 6px;
}
.mini.selected {
  background-color: #007aff;
  color: #ffffff;
}
.hint {
  font-size: 12px;
  color: #999999;
  margin-top: 6px;
}
.submit {
  margin-top: 12px;
}
</style>
