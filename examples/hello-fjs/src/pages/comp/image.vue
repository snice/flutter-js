<route>
{"title": "图片", "tag": "image", "group": "基础内容"}
</route>

<script setup lang="ts">
// image：mode、lazy-load 与 load/error 都在这一页做可操作回归。
import { computed, ref } from 'vue';
import Panel from '@/components/Panel.vue';
// vite/vue 的标准写法：打包器负责 URL，两端拿到的都是 /assets/<name>-<hash>.png
import localLandscape from '@/assets/test-landscape.png';
import localPortrait from '@/assets/test-portrait.png';

// 文件名与内置标签同名：显式命名，模板里的 <image> 才不会被当成自引用。
defineOptions({ name: 'ImagePage' });

const remote = 'https://picsum.photos/seed/fjs-image/600/400';
const lazyRemote = 'https://picsum.photos/seed/fjs-lazy-image/600/400';
const invalid = 'https://invalid.example/fjs-image.png';

// public/ 下的文件走根绝对路径，不经过打包器
const localSquare = '/images/test-square.png';
const localAlpha = '/images/test-alpha.png';
const localMissing = '/images/does-not-exist.png';

const modes = [
  'scaleToFill',
  'aspectFit',
  'aspectFill',
  'widthFix',
  'heightFix',
  'top',
  'bottom',
  'center',
  'left',
  'right',
  'top left',
  'top right',
  'bottom left',
  'bottom right',
] as const;

const mode = ref<(typeof modes)[number]>('aspectFill');
const source = ref(remote);
const loadPayload = ref('');
const errorPayload = ref('');
const lazyPayload = ref('');
const localPayload = ref('等待加载');
const localMissingPayload = ref('等待加载');

const sourceLabel = computed(() =>
  source.value === invalid ? 'invalid URL' : 'valid URL',
);

function onLoad(payload: string) {
  const image = JSON.parse(payload) as { width: number; height: number };
  loadPayload.value = `${payload}  (${image.width} x ${image.height})`;
  errorPayload.value = '';
}

function onError(payload: string) {
  errorPayload.value = payload;
  loadPayload.value = '';
}

function onLocalLoad(payload: string) {
  const image = JSON.parse(payload) as { width: number; height: number };
  localPayload.value = `load ${image.width} x ${image.height}`;
}

function onLocalError(payload: string) {
  localPayload.value = `error ${payload}`;
}

function onLazyLoad(payload: string) {
  lazyPayload.value = `load ${payload}`;
}

function onLazyError(payload: string) {
  lazyPayload.value = `error ${payload}`;
}
</script>

<template>
  <view>
    <Panel title="mode" :desc="`当前：${mode}`">
      <view class="mode-grid">
        <button
          v-for="item in modes"
          :key="item"
          size="mini"
          class="mode-button"
          :class="{ selected: item === mode }"
          @tap="mode = item"
        >
          {{ item }}
        </button>
      </view>
      <image
        :src="source"
        :mode="mode"
        fit="contain"
        class="mode-image"
        @load="onLoad"
        @error="onError"
      />
      <text class="event-value">{{ loadPayload || errorPayload || '等待加载' }}</text>
    </Panel>

    <Panel title="本地图片 import / public" :desc="localPayload">
      <image
        :src="localLandscape"
        mode="aspectFit"
        class="local-image"
        @load="onLocalLoad"
        @error="onLocalError"
      />
      <view class="row">
        <image :src="localSquare" class="thumb round" />
        <image :src="localAlpha" class="thumb alpha-bg" />
        <image :src="localPortrait" mode="heightFix" class="local-portrait" />
      </view>
      <text class="caption">import 的 240x160 / 120x240，public/ 的 128 圆形与透明图</text>
      <text class="caption">{{ localLandscape }}</text>
    </Panel>

    <Panel title="本地图片缺失（public/）" :desc="localMissingPayload">
      <image
        :src="localMissing"
        mode="aspectFit"
        class="local-image"
        @load="(p: string) => (localMissingPayload = `load ${p}`)"
        @error="(p: string) => (localMissingPayload = `error ${p}`)"
      />
      <text class="caption">不存在的本地文件应当只触发 @error。</text>
    </Panel>

    <Panel title="mode 优先于 fit" desc="mode=aspectFill，fit=contain">
      <image :src="remote" mode="aspectFill" fit="contain" class="compare-image" />
      <text class="caption">显式 mode 生效，旧 fit 只在未设置 mode 时使用。</text>
    </Panel>

    <Panel title="widthFix / heightFix">
      <view class="fix-row">
        <view class="fix-item">
          <image :src="remote" mode="widthFix" class="width-fix" />
          <text class="caption">widthFix</text>
        </view>
        <view class="fix-item">
          <image :src="remote" mode="heightFix" class="height-fix" />
          <text class="caption">heightFix</text>
        </view>
      </view>
    </Panel>

    <Panel title="load / error" :desc="`当前：${sourceLabel}`">
      <view class="action-row">
        <button size="mini" @tap="source = remote">有效图片</button>
        <button size="mini" @tap="source = invalid">无效图片</button>
      </view>
      <image :src="source" mode="aspectFit" class="event-image" @load="onLoad" @error="onError" />
      <text class="event-value">{{ loadPayload || errorPayload || '等待加载' }}</text>
    </Panel>

    <Panel title="lazy-load" :desc="lazyPayload || '向下滚动图片进入附近区域'">
      <scroll-view scroll-y class="lazy-scroll">
        <!-- enough rows that the image starts well outside the preload margin -->
          <view v-for="n in 16" :key="n" class="lazy-row">
          <text>lazy row {{ n }}</text>
        </view>
        <image
          :src="lazyRemote"
          mode="aspectFill"
          lazy-load
          class="lazy-image"
          @load="onLazyLoad"
          @error="onLazyError"
        />
      </scroll-view>
    </Panel>

    <Panel title="尺寸与圆角">
      <view class="row">
        <image :src="remote" class="thumb round" />
        <image :src="remote" class="thumb rounded" />
        <image :src="remote" class="thumb" />
      </view>
      <text class="caption">圆形头像 / 圆角 / 直角</text>
    </Panel>

    <Panel title="图文卡片">
      <view class="card-row">
        <image :src="remote" class="cover" />
        <view class="card-body">
          <text class="card-title">列表图文</text>
          <text class="card-desc">
            image 与 view / text 组合，就是最常见的信息流卡片布局。
          </text>
        </view>
      </view>
    </Panel>
  </view>
</template>

<style scoped>
.mode-grid {
  flex-direction: row;
  flex-wrap: wrap;
  gap: 6px;
}
.mode-button {
  max-width: 110px;
}
.mode-button.selected {
  background-color: #007aff;
  color: #ffffff;
}
.mode-image {
  width: 280px;
  height: 170px;
  border-radius: 10px;
  background-color: #f4f5f7;
}
.event-value {
  font-size: 12px;
  color: #666666;
  min-height: 25px;
}
.local-image {
  width: 280px;
  height: 160px;
  border-radius: 8px;
  background-color: #f4f5f7;
}
.alpha-bg {
  background-color: #ffd60a;
}
.local-portrait {
  height: 64px;
}
.compare-image {
  width: 280px;
  height: 150px;
  border-radius: 8px;
  background-color: #f4f5f7;
}
.fix-row {
  flex-direction: row;
  gap: 16px;
  align-items: flex-start;
}
.fix-item {
  width: 120px;
  gap: 6px;
}
.width-fix {
  width: 120px;
  background-color: #f4f5f7;
}
.height-fix {
  height: 80px;
  width: 120px;
  background-color: #f4f5f7;
}
.action-row {
  flex-direction: row;
  gap: 8px;
}
.event-image {
  width: 280px;
  height: 120px;
  background-color: #f4f5f7;
}
.lazy-scroll {
  height: 260px;
  gap: 8px;
  padding: 8px;
  background-color: #f4f5f7;
  border-radius: 8px;
}
.lazy-image {
  /* A lazy image has no src until it scrolls in, so it has no intrinsic
     size either — without a box here it collapses to 0px tall and never
     intersects anything. */
  width: 240px;
  height: 140px;
  border-radius: 8px;
  background-color: #ffffff;
}
.lazy-row {
  height: 36px;
  padding: 8px;
  background-color: #ffffff;
  border-radius: 6px;
}
.row {
  flex-direction: row;
  gap: 12px;
  align-items: center;
}
.thumb {
  width: 64px;
  height: 64px;
}
.round {
  border-radius: 32px;
}
.rounded {
  border-radius: 10px;
}
.caption {
  font-size: 12px;
  color: #999999;
}
.card-row {
  flex-direction: row;
  gap: 12px;
}
.cover {
  width: 96px;
  height: 72px;
  border-radius: 8px;
}
.card-body {
  flex-grow: 1;
  gap: 4px;
}
.card-title {
  font-size: 15px;
  font-weight: 600;
}
.card-desc {
  font-size: 12px;
  color: #999999;
  max-lines: 2;
  overflow: ellipsis;
}
</style>
