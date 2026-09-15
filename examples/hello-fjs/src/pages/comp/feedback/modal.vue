<route>
{"title": "弹窗", "tag": "modal", "group": "交互反馈"}
</route>

<script setup lang="ts">
// modal：visible 驱动的 BottomSheet。置回 false 会关闭，原生手势关闭回派 @modal-closed。
import { ref } from 'vue';
import { toast } from 'fjs';
import Panel from '@/components/Panel.vue';

// 文件名与内置标签同名：显式命名，模板里的 <modal> 才不会被当成自引用。
defineOptions({ name: 'ModalPage' });

const visible = ref(false);
const sheet = ref(false);
</script>

<template>
  <view>
    <Panel title="确认弹窗" desc="visible 驱动 BottomSheet：置 false 关闭，下滑/点遮罩关闭回派 onModalClosed">
      <button class="btn primary" @tap="visible = true">打开弹窗</button>
      <text class="hint">状态：{{ visible ? '打开' : '关闭' }}</text>
    </Panel>

    <Panel title="底部菜单">
      <button class="btn" @tap="sheet = true">打开操作菜单</button>
    </Panel>

    <modal :visible="visible" @modal-closed="visible = false">
      <view class="dialog">
        <text class="dialog-title">确认删除？</text>
        <text class="dialog-desc">
          删除后不可恢复。弹窗打开期间内容保持响应式更新，按钮事件照常回派 JS。
        </text>
        <view class="actions">
          <view class="col">
            <button class="btn" @tap="visible = false">取消</button>
          </view>
          <view class="col">
            <button class="btn danger" @tap="() => { visible = false; toast('已删除'); }">
              删除
            </button>
          </view>
        </view>
      </view>
    </modal>

    <modal :visible="sheet" @modal-closed="sheet = false">
      <view class="menu">
        <button
          v-for="action in ['分享', '收藏', '举报']"
          :key="action"
          class="btn"
          @tap="() => { sheet = false; toast(action); }"
        >
          {{ action }}
        </button>
      </view>
    </modal>
  </view>
</template>

<style scoped>
.btn {
  border-radius: 8px;
}
.primary {
  background-color: #007aff;
  color: #ffffff;
}
.danger {
  background-color: #dd524d;
  color: #ffffff;
}
.hint {
  font-size: 12px;
  color: #999999;
}
.dialog {
  padding: 20px;
  gap: 12px;
}
.dialog-title {
  font-size: 17px;
  font-weight: 600;
}
.dialog-desc {
  font-size: 13px;
  color: #999999;
}
.actions {
  flex-direction: row;
  gap: 12px;
}
.col {
  flex-grow: 1;
}
.menu {
  padding: 8px;
}
</style>
