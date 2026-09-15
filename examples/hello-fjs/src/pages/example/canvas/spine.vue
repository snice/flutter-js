<route>
{"title": "Spine 骨骼动画", "group": "画布演示", "desc": "@ufjs/spine：SpinePlayer 播放 spineboy，canvas 2d 三端同源"}
</route>

<script setup lang="ts">
// Spine 骨骼动画：用 @ufjs/spine 的 SpinePlayer，配置项和官方 spine-player 一致
// （skeleton / atlas / animation / viewport / controlBones …），只是不给 DOM
// 父节点，而是给 canvas 的 2d context。播放器自己跑帧循环、按动画包围盒算视口、
// 切动画时视口平滑过渡；控制条这类 UI 由页面用 fjs 组件搭。
//
// 素材在 public/spine/，来自 spine-runtimes 仓库的 spineboy：
// 官方只给了 PMA（预乘 alpha）贴图，canvas 2d 按直通 alpha 合成，直接用会在
// 半透明边缘发黑，所以贴图已离线反预乘、atlas 去掉了 `pma: true`。
//
// 画布只做两件事：@resize 把逻辑尺寸交给 player.resize()，触摸转给
// player.handleTouch()（拖 controlBones 里的骨骼，这里是 root——整个角色）。
import { onActivated, onDeactivated, onUnmounted, ref } from 'vue';
import { SpinePlayer } from '@ufjs/spine';
import type { FjsCanvasApi, FjsTouchEvent } from 'fjs';
import Panel from '@/components/Panel.vue';

defineOptions({ name: 'SpinePage' });

const SPEEDS = [0.5, 1, 2] as const;

const cv = ref();
const status = ref('加载中…');
const animations = ref<string[]>([]);
const current = ref('walk');
const paused = ref(false);
const speed = ref(1);
/** 0..100，给 slider 的整数值。 */
const progress = ref(0);
const debug = ref(false);
const viewportDebug = ref(false);

let player: SpinePlayer | null = null;
/** 进度条每帧写响应式会让整页每帧 diff 一次；10 次/秒足够跟手。 */
let lastProgressAt = 0;

function createPlayer(canvas: FjsCanvasApi): SpinePlayer | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  return new SpinePlayer(ctx, {
    skeleton: '/spine/spineboy-pro.skel',
    atlas: '/spine/spineboy.atlas',
    animation: current.value,
    defaultMix: 0.2,
    controlBones: ['root'],
    success(p) {
      animations.value = p.getAnimationNames();
      status.value = '';
    },
    error(_p, message) {
      status.value = message;
    },
    draw(p) {
      const now = Date.now();
      if (p.paused || now - lastProgressAt < 100) return;
      lastProgressAt = now;
      progress.value = Math.round(p.getProgress() * 100);
    },
  });
}

function onResize(): void {
  const canvas = cv.value as FjsCanvasApi | undefined;
  if (!canvas) return;
  player ??= createPlayer(canvas);
  player?.resize(canvas.width, canvas.height);
}

function onTouch(type: 'start' | 'move' | 'end', event: FjsTouchEvent): void {
  const touch = event.touches[0] ?? event.changedTouches[0];
  if (touch) player?.handleTouch(type, touch.offsetX, touch.offsetY);
}

function play(name: string): void {
  if (!player?.skeleton) return;
  current.value = name;
  // 视口按新动画的包围盒重算，transitionTime（默认 0.25s）内平滑过去
  player.setAnimation(name, true);
  if (player.paused) togglePlay();
}

function togglePlay(): void {
  if (!player) return;
  if (player.paused) player.play();
  else player.pause();
  paused.value = player.paused;
}

function setSpeed(value: number): void {
  speed.value = value;
  if (player) player.speed = value;
}

function seek(value: string): void {
  progress.value = Number(value);
  player?.seek(progress.value / 100);
  paused.value = true;
}

// player.config 按引用持有（和官方一样），改字段下一帧生效
function setDebug(on: boolean): void {
  debug.value = on;
  if (player) player.config.debug = { bones: on, meshes: on, regions: on };
}

function setViewportDebug(on: boolean): void {
  viewportDebug.value = on;
  if (player) player.config.viewport!.debugRender = on;
}

// 路由是 keep-alive 的：离开就停帧回调，回来再接上
onActivated(() => player?.startRendering());
onDeactivated(() => player?.stopRendering());
onUnmounted(() => {
  player?.dispose();
  player = null;
});
</script>

<template>
  <view>
    <Panel title="SpinePlayer" desc="拖动红圈（root 骨骼）移动角色；切动画时视口平滑过渡">
      <canvas
        ref="cv"
        class="stage"
        @resize="onResize"
        @touchstart="(e: FjsTouchEvent) => onTouch('start', e)"
        @touchmove="(e: FjsTouchEvent) => onTouch('move', e)"
        @touchend="(e: FjsTouchEvent) => onTouch('end', e)"
      >
        <view v-if="status" class="mask">
          <text class="mask-text">{{ status }}</text>
        </view>
      </canvas>

      <view class="bar">
        <button size="mini" type="primary" @tap="togglePlay">{{ paused ? '播放' : '暂停' }}</button>
        <view class="grow">
          <slider :value="progress" :min="0" :max="100" @change="seek" />
        </view>
      </view>

      <view class="row">
        <button
          v-for="value in SPEEDS"
          :key="value"
          size="mini"
          :type="speed === value ? 'primary' : 'default'"
          @tap="setSpeed(value)"
        >
          {{ value }}x
        </button>
      </view>
    </Panel>

    <Panel title="动画" :desc="`player.setAnimation(name)，共 ${animations.length} 个`">
      <view class="row">
        <button
          v-for="name in animations"
          :key="name"
          size="mini"
          :type="current === name ? 'primary' : 'default'"
          @tap="play(name)"
        >
          {{ name }}
        </button>
      </view>
    </Panel>

    <Panel title="调试" desc="同官方 spine-player 的 debug / viewport.debugRender">
      <view class="switch-row">
        <text class="label">骨骼与网格线框 debug</text>
        <switch :value="debug" @change="(v: string) => setDebug(v === '1')" />
      </view>
      <view class="switch-row">
        <text class="label">视口边界 viewport.debugRender</text>
        <switch :value="viewportDebug" @change="(v: string) => setViewportDebug(v === '1')" />
      </view>
      <text class="tip">绿框是动画包围盒，红框是加上 10% 留白后的实际视口</text>
    </Panel>
  </view>
</template>

<style scoped>
.stage {
  width: 100%;
  height: 300px;
  border-radius: 8px;
  background-color: #2b2f36;
  touch-action: none;
}
.mask {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.mask-text {
  font-size: 13px;
  color: #ffffff;
}
.bar {
  flex-direction: row;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
}
.grow {
  flex: 1;
}
.row {
  flex-direction: row;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
.switch-row {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
}
.label {
  font-size: 14px;
  color: var(--fjs-text);
}
.tip {
  font-size: 12px;
  color: var(--fjs-faint);
  margin-top: 8px;
}
</style>
