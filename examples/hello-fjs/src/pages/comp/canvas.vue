<route>
{"title": "画布", "tag": "canvas", "group": "画布"}
</route>

<script setup lang="ts">
// canvas：两端同一份绘制代码。App 侧命令编码成显示列表交给 Flutter 的
// CustomPaint 回放，web 侧就是浏览器原生 context——所以这一页也是「两端对拍」
// 用的页面，每块画的东西在两边应当一模一样（字体度量的亚像素差除外）。
import { ref } from 'vue';
import type { FjsCanvasApi, FjsCanvasContext2D } from 'fjs';
import Panel from '@/components/Panel.vue';

// 文件名与内置标签同名：显式命名，模板里的 <canvas> 才不会被当成自引用。
defineOptions({ name: 'CanvasPage' });

// 用 fjs 的 context 类型而不是 DOM 的：它就是兼容清单
// （docs/canvas-compat.md）的类型化版本，写了 App 端做不到的方法会直接编译报错。
type Ctx = FjsCanvasContext2D;

const shapes = ref();
const paths = ref();
const text = ref();
const gradient = ref();
const shadow = ref();
const clip = ref();
const dpr = ref();

/** 拿到 2d 上下文并画一次。
 *
 *  **在 `@resize` 里画，不在 `onMounted` 里画**：App 侧的 canvas 要等宿主布局
 *  完才有尺寸，`onMounted` 时 `width`/`height` 还是 0。`@resize` 两端都派，
 *  载荷一样，所以这一份代码两端都对。 */
function draw(
  canvas: FjsCanvasApi | undefined,
  paint: (ctx: Ctx, w: number, h: number) => void,
): void {
  const ctx = canvas?.getContext('2d');
  if (!ctx || !canvas) return;
  paint(ctx, canvas.width, canvas.height);
}

// 每块画布只画自己：@resize 是逐个 canvas 派的，用一个函数把七块都画一遍的话，
// 尺寸还没到的那几块会以 0 尺寸画一次，而 canvas 是保留式的——那一次的结果会
// 留在画面上，等它自己的 @resize 到了再叠一层。
function paintShapes(): void {
  draw(shapes.value, (ctx) => {
    ctx.fillStyle = '#07c160';
    ctx.fillRect(12, 12, 80, 48);
    ctx.strokeStyle = '#007aff';
    ctx.lineWidth = 3;
    ctx.strokeRect(108, 12, 80, 48);
    ctx.fillStyle = 'rgba(255, 59, 48, 0.6)';
    ctx.fillRect(60, 36, 80, 48);
  });

}

function paintPaths(): void {
  draw(paths.value, (ctx) => {
    ctx.strokeStyle = '#007aff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(16, 80);
    ctx.lineTo(60, 24);
    ctx.lineTo(104, 64);
    ctx.lineTo(148, 16);
    ctx.stroke();

    ctx.fillStyle = '#ffcc00';
    ctx.beginPath();
    ctx.arc(210, 48, 32, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#ff3b30';
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(16, 96);
    ctx.lineTo(260, 96);
    ctx.stroke();
    ctx.setLineDash([]);
  });

}

function paintText(): void {
  draw(text.value, (ctx) => {
    ctx.fillStyle = '#111111';
    ctx.font = '18px sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText('fjs canvas 文本', 12, 10);
    ctx.font = 'italic bold 14px sans-serif';
    ctx.fillStyle = '#888888';
    ctx.fillText('italic bold 14px', 12, 38);
    // measureText 在 App 侧是一次同步 host 调用（Flutter 的 TextPainter），
    // 在 web 侧是浏览器原生——数值会有亚像素差，位置对齐的逻辑两端一致
    const sample = '居中对齐';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#07c160';
    ctx.fillText(sample, 150, 66);
    ctx.textAlign = 'start';
    ctx.fillStyle = '#cccccc';
    ctx.fillText(`measureText 宽度 ${ctx.measureText(sample).width.toFixed(1)}`, 12, 90);
  });

}

function paintGradient(): void {
  draw(gradient.value, (ctx, w) => {
    const linear = ctx.createLinearGradient(12, 0, w - 12, 0);
    linear.addColorStop(0, '#007aff');
    linear.addColorStop(1, '#07c160');
    ctx.fillStyle = linear;
    ctx.fillRect(12, 12, w - 24, 36);

    const radial = ctx.createRadialGradient(w / 2, 84, 0, w / 2, 84, 34);
    radial.addColorStop(0, '#ffcc00');
    radial.addColorStop(1, 'rgba(255, 204, 0, 0)');
    ctx.fillStyle = radial;
    ctx.fillRect(w / 2 - 40, 50, 80, 68);
  });

}

function paintShadow(): void {
  draw(shadow.value, (ctx) => {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(20, 16, 100, 60);
    ctx.fillStyle = '#007aff';
    ctx.beginPath();
    ctx.arc(190, 46, 30, 0, Math.PI * 2);
    ctx.fill();
  });

}

function paintClip(): void {
  draw(clip.value, (ctx, w, h) => {
    ctx.save();
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 8, 0, Math.PI * 2);
    ctx.clip();
    // 条纹整块画出去，只有圆里露出来
    for (let x = 0; x < w; x += 16) {
      ctx.fillStyle = (x / 16) % 2 === 0 ? '#007aff' : '#ffffff';
      ctx.fillRect(x, 0, 16, h);
    }
    ctx.restore();
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 8, 0, Math.PI * 2);
    ctx.stroke();
  });

}

function paintDpr(): void {
  draw(dpr.value, (ctx, w, h) => {
    // 坐标系两端都是逻辑像素：这条 1px 线在两端都应当是同样的粗细，
    // 页面不需要乘 devicePixelRatio（docs/canvas-compat.md）
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2 + 0.5);
    ctx.lineTo(w, h / 2 + 0.5);
    ctx.stroke();
    ctx.fillStyle = '#888888';
    ctx.font = '12px sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(`盒子 ${w} x ${h}（逻辑像素）`, 0, h / 2 + 8);
  });
}
</script>

<template>
  <view>
    <Panel title="矩形" desc="fillRect / strokeRect / 半透明叠加">
      <canvas ref="shapes" class="cv" @resize="paintShapes" />
    </Panel>

    <Panel title="路径" desc="折线 / 圆 / 虚线">
      <canvas ref="paths" class="cv" @resize="paintPaths" />
    </Panel>

    <Panel title="文本" desc="font / textAlign / measureText">
      <canvas ref="text" class="cv" @resize="paintText" />
    </Panel>

    <Panel title="渐变" desc="线性与径向">
      <canvas ref="gradient" class="cv cv-tall" @resize="paintGradient" />
    </Panel>

    <Panel title="阴影" desc="shadowColor / shadowBlur / shadowOffset">
      <canvas ref="shadow" class="cv" @resize="paintShadow" />
    </Panel>

    <Panel title="裁剪" desc="clip() 之后画的内容只在路径里可见">
      <canvas ref="clip" class="cv" @resize="paintClip" />
    </Panel>

    <Panel title="坐标系" desc="逻辑像素，dpr 由宿主处理">
      <canvas ref="dpr" class="cv cv-short" @resize="paintDpr" />
    </Panel>
  </view>
</template>

<style scoped>
.cv {
  width: 100%;
  height: 120px;
}
.cv-tall {
  height: 130px;
}
.cv-short {
  height: 60px;
}
</style>
