<route>
{"title": "@vueuse/motion", "group": "动画演示", "desc": "variants 入场 / 弹簧 / spring 驱动数值"}
</route>

<script setup lang="ts">
// @vueuse/motion on both hosts, one source (spec 042).
//
// Unlike Anime.js (spec 031), motion's directive path writes styles itself:
// `el.style[key] = v` against the vnode's element. That works here because
// the runtime gives fjs elements a DOM-shaped `style` object whose writes go
// into the style engine's inline layer (same record as a `:style` binding).
// The frame loop needed a `window` polyfill — see src/motion/native-
// polyfills.ts, imported by src/plugins/motion.ts before the library.
//
// What stays off-limits on the app: `hovered` / `tapped` / `focused` variants
// (they install DOM event listeners) and `visible` variants (Intersection
// Observer). Everything below uses only initial/enter/named variants and
// transitions, which are rAF + style writes.
import { onBeforeUnmount, reactive, ref } from 'vue';
import { useSpring } from '@vueuse/motion';
import Panel from '@/components/Panel.vue';

// ── 入场 variants + stagger ──────────────────────────────────────────────

const CHIPS = ['spring', 'variants', 'enter', 'delay', 'stagger', 'fjs'];

// Remounting re-runs the `enter` variant — the cheapest way to replay a
// directive-driven entrance on both hosts (no instance handles needed).
const enterRun = ref(0);
function replayEnter(): void {
  enterRun.value++;
}

// ── 弹簧对比 ─────────────────────────────────────────────────────────────

const SPRINGS = [
  { name: '硬', desc: 'stiffness 400 · damping 17', stiffness: 400, damping: 17 },
  { name: '默认', desc: 'stiffness 170 · damping 26', stiffness: 170, damping: 26 },
  { name: '软', desc: 'stiffness 90 · damping 14', stiffness: 90, damping: 14 },
];
const LANE = 210;

// Minimal shape of what the v-motion directive leaves on the element; the
// full MotionInstance type is not worth importing for two methods.
interface MotionHandle {
  motionInstance?: {
    apply: (variant: string) => Promise<unknown>;
    stop: () => void;
  };
}

const ballEls = new Map<number, MotionHandle>();

function setBall(i: number) {
  return (el: unknown) => {
    if (!el) return;
    // On web a function ref on <view> hands back the component instance;
    // the directive hangs motionInstance on its root element. Flutter hands
    // back the fjs element itself, which is already the right object.
    const dom = ((el as { $el?: unknown }).$el ?? el) as MotionHandle;
    ballEls.set(i, dom);
  };
}

function goBalls(direction: 'right' | 'left'): void {
  for (const el of ballEls.values()) {
    void el.motionInstance?.apply(direction);
  }
}

// ── spring 驱动数值 ──────────────────────────────────────────────────────

const bar = reactive({ width: 0 });
// useSpring tweens properties of a reactive object through a spring; the
// template just binds the object — motion fills in every frame.
const springBar = useSpring(bar, { stiffness: 90, damping: 15 });

function loadBar(pct: number): void {
  void springBar.set({ width: pct });
}

onBeforeUnmount(() => {
  for (const el of ballEls.values()) el.motionInstance?.stop();
  springBar.stop();
  ballEls.clear();
});
</script>

<template>
  <view>
    <Panel title="入场 variants" desc="v-motion + :initial/:enter，delay 按序号递增做 stagger">
      <view class="chip-row">
        <view
          v-for="(chip, i) in CHIPS"
          :key="`${enterRun}-${chip}`"
          v-motion
          class="chip"
          :initial="{ opacity: 0, y: 24, scale: 0.7 }"
          :enter="{ opacity: 1, y: 0, scale: 1, transition: { type: 'spring', delay: i * 70 } }"
        >
          <text class="chip-text">{{ chip }}</text>
        </view>
      </view>
      <button size="mini" type="primary" @tap="replayEnter()">重播入场</button>
    </Panel>

    <Panel title="弹簧对比" desc="同一段位移，三组 spring 参数；实例句柄在元素上">
      <view v-for="(spring, i) in SPRINGS" :key="spring.name" class="lane-row">
        <text class="lane-name">{{ spring.name }}</text>
        <view class="lane">
          <view
            v-motion
            class="ball"
            :ref="setBall(i)"
            :variants="{
              initial: { x: 0 },
              right: { x: LANE, transition: { type: 'spring', stiffness: spring.stiffness, damping: spring.damping } },
              left: { x: 0, transition: { type: 'spring', stiffness: spring.stiffness, damping: spring.damping } },
            }"
            :style="{ backgroundColor: ['#007aff', '#07c160', '#fa9d3b'][i] }"
          />
        </view>
        <text class="lane-desc">{{ spring.desc }}</text>
      </view>
      <view class="row">
        <button size="mini" type="primary" @tap="goBalls('right')">出发</button>
        <button size="mini" @tap="goBalls('left')">返回</button>
      </view>
    </Panel>

    <Panel title="spring 驱动数值" desc="useSpring 缓动 reactive 对象，进度条只是绑定它">
      <view class="track">
        <view class="track-fill" :style="{ width: `${bar.width}%` }" />
      </view>
      <text class="bar-value">{{ Math.round(bar.width) }}%</text>
      <slider :value="Math.round(bar.width)" :min="0" :max="100" @change="loadBar(Number($event))" />
      <view class="row">
        <button size="mini" @tap="loadBar(20)">20%</button>
        <button size="mini" @tap="loadBar(60)">60%</button>
        <button size="mini" type="primary" @tap="loadBar(100)">100%</button>
      </view>
    </Panel>
  </view>
</template>

<style scoped>
.chip-row {
  flex-direction: row;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}
.chip {
  padding: 4px 12px;
  border-radius: 14px;
  background-color: var(--fjs-primary);
}
.chip-text {
  color: #ffffff;
  font-size: 13px;
}
.row {
  flex-direction: row;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
.lane-row {
  margin-bottom: 12px;
}
.lane {
  position: relative;
  height: 24px;
  border-radius: 12px;
  background-color: var(--fjs-border);
}
.ball {
  position: absolute;
  left: 4px;
  top: 2px;
  width: 20px;
  height: 20px;
  border-radius: 10px;
}
.lane-desc {
  font-size: 11px;
  color: var(--fjs-faint);
  margin-top: 2px;
}
.track {
  height: 6px;
  border-radius: 3px;
  background-color: var(--fjs-border);
  overflow: hidden;
}
.track-fill {
  height: 6px;
  background-color: var(--fjs-success);
}
.bar-value {
  font-size: 22px;
  font-weight: 700;
  color: var(--fjs-title);
  text-align: center;
  margin: 8px 0;
}
</style>
