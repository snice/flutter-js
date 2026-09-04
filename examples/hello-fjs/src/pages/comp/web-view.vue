<route>
{"title": "网页容器", "tag": "web-view", "group": "视图容器"}
</route>

<script setup lang="ts">
// web-view：模块 @ufjs/webview 提供的标签，app 侧是 WKWebView / WebView，
// web 侧是 iframe。这一页验证三件事：它是普通盒子（不铺满整页）、asset://
// 能加载模块自带的页面、消息能双向走。
import { ref } from 'vue';
import Panel from '@/components/Panel.vue';

// 文件名与标签同名：显式命名，模板里的 <web-view> 才不会被当成自引用。
defineOptions({ name: 'WebViewPage' });

const local = 'asset://demo.html?q=hello#top';
const remote = 'https://m.baidu.com';

const src = ref(local);
const loaded = ref('');
const failed = ref('');
const messages = ref<string[]>([]);

function onLoad(payload: string) {
  loaded.value = payload;
  failed.value = '';
}

function onError(payload: string) {
  failed.value = payload;
  loaded.value = '';
}

function onMessage(payload: string) {
  const { data } = JSON.parse(payload) as { data: string };
  messages.value = [data, ...messages.value].slice(0, 5);
}
</script>

<template>
  <view>
    <Panel title="一半原生，一半网页" desc="它是普通盒子，不会铺满整页">
      <view class="row">
        <button
          size="mini"
          class="mini"
          :class="{ selected: src === local }"
          @tap="src = local"
        >
          模块自带页面
        </button>
        <button
          size="mini"
          class="mini"
          :class="{ selected: src === remote }"
          @tap="src = remote"
        >
          外部网页
        </button>
      </view>
      <web-view
        class="frame"
        :src="src"
        @load="onLoad"
        @error="onError"
        @message="onMessage"
      />
      <text class="hint">上面这行按钮和下面这段文字都还在——网页只占它自己的盒子。</text>
    </Panel>

    <Panel title="@load / @error" :desc="failed || loaded || '等待加载'">
      <text class="value">{{ failed || loaded || '（还没有）' }}</text>
    </Panel>

    <Panel
      title="@message"
      desc="网页里点按钮；页面加载完还会自动发一条 ready"
    >
      <view v-if="messages.length === 0">
        <text class="hint">（还没收到消息）</text>
      </view>
      <view v-for="(item, i) in messages" :key="`${i}-${item}`" class="msg">
        <text>{{ item }}</text>
      </view>
    </Panel>
  </view>
</template>

<style scoped>
.row {
  flex-direction: row;
  gap: 8px;
  margin-bottom: 8px;
}
.mini {
  border-radius: 6px;
}
.mini.selected {
  background-color: #007aff;
  color: #ffffff;
}
.frame {
  height: 220px;
  border-radius: 8px;
  background-color: #f4f5f7;
}
.hint {
  font-size: 12px;
  color: #999999;
  margin-top: 8px;
}
.value {
  font-size: 12px;
  color: #666666;
}
.msg {
  padding: 6px 8px;
  background-color: #f7f7f7;
  border-radius: 6px;
  margin-top: 6px;
}
</style>
