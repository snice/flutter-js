import { h, createRoot, setText, invokeHost, toast, Worker, nowMs } from 'fjs';

const root = createRoot('view');
root.appendChild(h('text', { style: { fontSize: 26, fontWeight: 'bold', margin: 16 } }, 'Component Gallery'));
root.appendChild(h('text', { style: { fontSize: 13, color: '#888888', margin: 12 } },
  'engine ' + __fjs.engine.engineId + ' — all tags below map to native widgets'));

// ===================================================================
// 组件总览演示（覆盖全部已实现组件）
// ===================================================================
function section(title: string): void {
  root.appendChild(h('divider', { style: { margin: 12, color: '#DDDDDD' } }));
  root.appendChild(h('text', { style: { fontSize: 16, fontWeight: 'bold', margin: 12, color: '#333333' } }, title));
}

// ---- 基础（v1）-----------------------------------------------------------
section('基础: text / image / input');
root.appendChild(h('text', { style: { fontSize: 14, color: '#666666', margin: 12 } },
  'input 输入会实时回显（textarea 加 multiline）'));
const echo = h('text', { style: { fontSize: 13, margin: 12, color: '#1a73e8' } }, 'input echo: —');
root.appendChild(h('input', {
  placeholder: 'type something…',
  onTextChanged: (t: string) => setText(echo, 'input echo: ' + t),
  onSubmit: (t: string) => toast('submitted: ' + t),
}));
root.appendChild(echo);
root.appendChild(h('input', { placeholder: 'multiline…', multiline: true, style: { margin: 12 } }));

// ---- 表单控件 --------------------------------------------------------------
section('表单: switch / checkbox / slider');
const switchState = h('text', { style: { fontSize: 13, color: '#2e7d32' } }, 'switch: off');
root.appendChild(h('view', { style: { flexDirection: 'row', alignItems: 'center', margin: 12 } }, [
  h('switch', {
    value: false,
    onValueChanged: (v: string) => {
      setText(switchState, 'switch: ' + (v === '1' ? 'on' : 'off'));
      toast(v === '1' ? 'enabled' : 'disabled');
    },
  }),
  switchState,
]));

const checkState = h('text', { style: { fontSize: 13, color: '#2e7d32' } }, 'checkbox: unchecked');
root.appendChild(h('view', { style: { flexDirection: 'row', alignItems: 'center', margin: 12 } }, [
  h('checkbox', {
    value: false,
    onValueChanged: (v: string) => setText(checkState, 'checkbox: ' + (v === '1' ? 'checked' : 'unchecked')),
  }),
  checkState,
]));

const sliderVal = h('text', { style: { fontSize: 13, color: '#2e7d32', margin: 12 } }, 'slider: 50');
root.appendChild(h('slider', {
  value: 50, min: 0, max: 100,
  onValueChanged: (v: string) => setText(sliderVal, 'slider: ' + Math.round(Number(v))),
}));
root.appendChild(sliderVal);

const bar = h('progress', { value: 0.3, style: { margin: 12 } });
const progressLabel = h('text', { style: { fontSize: 13, color: '#888888', margin: 12 } }, 'progress: 30%');
root.appendChild(bar);
root.appendChild(progressLabel);
let pct = 30;
setInterval(() => {
  pct = (pct + 5) % 105;
  bar.setProps({ value: Math.min(pct, 100) / 100 });
  setText(progressLabel, 'progress: ' + Math.min(pct, 100) + '%');
}, 400);

// ---- 布局进阶 ---------------------------------------------------------------
section('布局: stack / safe-area');
const stack = h('stack', { style: { height: 120, margin: 12, backgroundColor: '#E8EAF6', borderRadius: 8 } });
stack.appendChild(h('view', {
  style: { position: 'absolute', left: 12, top: 12, width: 60, height: 60, backgroundColor: '#5C6BC0', borderRadius: 8 },
}));
stack.appendChild(h('view', {
  style: { position: 'absolute', right: 12, top: 30, width: 60, height: 60, backgroundColor: '#26A69A', borderRadius: 30 },
}));
stack.appendChild(h('text', {
  style: { position: 'absolute', left: 90, top: 50, color: '#333333', fontSize: 13 },
}, 'absolute 定位'));
root.appendChild(stack);

// ---- 交互 -------------------------------------------------------------------
section('交互: swiper / modal / toast');
const pageLabel = h('text', { style: { fontSize: 13, color: '#888888', margin: 12 } }, 'swiper page: 0');
const swiper = h('swiper', { style: { height: 90, margin: 12 }, onPageChanged: (i: string) => setText(pageLabel, 'swiper page: ' + i) });
const p1 = h('view', { style: { backgroundColor: '#BBDEFB', borderRadius: 8 } },
  [h('text', { style: { textAlign: 'center', margin: 30 } }, 'page 1')]);
const p2 = h('view', { style: { backgroundColor: '#C8E6C9', borderRadius: 8 } },
  [h('text', { style: { textAlign: 'center', margin: 30 } }, 'page 2')]);
swiper.appendChild(p1);
swiper.appendChild(p2);
root.appendChild(swiper);
root.appendChild(pageLabel);

const sheet = h('view', { style: { margin: 20 } }, [
  h('text', { style: { fontSize: 16, fontWeight: 'bold' } }, 'Bottom Sheet'),
  h('text', { style: { margin: 8, fontSize: 13 } }, 'modal 打开时的内容快照'),
  h('button', { onTap: () => sheetVisible.setProps({ visible: false }) }, 'close'),
]);
const sheetVisible = h('modal', { visible: false }, [sheet]);
root.appendChild(h('button', {
  onTap: () => {
    sheetVisible.setProps({ visible: true });
    toast('modal opened');
  },
}, 'open modal'));
root.appendChild(sheetVisible);

// ---- Worker（后台线程）--------------------------------------------------------
section('Worker: 后台线程计算');
const workerLabel = h('text', { style: { fontSize: 13, color: '#1a73e8', margin: 12 } }, 'worker: idle');
const workerCode = [
  'onmessage = function (e) {',
  '  var rounds = parseInt(e.data, 10) || 5;',
  '  var a = 1, b = 1;',
  '  for (var i = 0; i < rounds; i++) { var t = a + b; a = b; b = t; }',
  '  postMessage("fib step -> " + a);',
  '};',
].join('\n');
const w = new Worker(workerCode);
w.onmessage = (e: { data: string }) => setText(workerLabel, 'worker: ' + e.data);
root.appendChild(h('button', { onTap: () => { w.postMessage(String(Date.now() % 20 + 5)); toast('sent to worker'); } }, 'run in worker'));
root.appendChild(workerLabel);

// ---- Dart 注册组件 ------------------------------------------------------------
section('Dart 注册组件');
root.appendChild(h('dart-clock', { title: 'Analog clock (Dart)', city: 'local' }));
