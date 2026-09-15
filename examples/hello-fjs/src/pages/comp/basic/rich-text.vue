<route>
{"title": "富文本", "tag": "rich-text", "group": "基础内容"}
</route>

<script setup lang="ts">
// rich-text：nodes 是 HTML 字符串或节点数组，白名单、默认样式、列表编号、
// 表格退化都在 JS 里（components/rich-text.ts），两端同一份。
// 这一页也是 spec 034 的对拍页：web 与 iOS 并排截图比段落数 / 列表项数 / 图片数。
import { nextTick, ref } from 'vue';
import { flushNow, nowMs, type RichTextNode } from 'fjs';
import Panel from '@/components/Panel.vue';
import localLandscape from '@/assets/test-landscape.png';

// 文件名与内置标签同名：显式命名，模板里的 <rich-text> 才不会被当成自引用。
defineOptions({ name: 'RichTextPage' });

const basic = `
  <h3>限时活动</h3>
  <p>满 <b style="color:#FA5151">199</b> 减 30，<i>仅限今日</i>&nbsp;&gt;</p>
  <p><u>下划线</u>、<s>删除线</s>、<mark>高亮</mark>、<code>code</code>、<small>小字</small>、<big>大字</big>，<q>引号</q></p>
  <p>第一行<br>第二行（br 换行）</p>
`;

const nodes: RichTextNode[] = [
  {
    name: 'div',
    attrs: { style: 'padding: 8px; background-color: #F7F7F7; border-radius: 6px' },
    children: [
      { type: 'text', text: 'Hello&nbsp;' },
      { name: 'STRONG', children: [{ type: 'text', text: 'rich-text' }] },
      { type: 'text', text: '，节点数组写法，name 大小写不敏感。' },
    ],
  },
];

const spaceSample = '<p>a    b  中    文</p>';
const spaces = ['', 'nbsp', 'ensp', 'emsp'] as const;

const lists = `
  <ul>
    <li>无序列表</li>
    <li>第二项<ul><li>嵌套一层</li><li>嵌套两项<ul><li>第三层</li></ul></li></ul></li>
  </ul>
  <ol start="3" type="A"><li>从 C 开始</li><li>D</li></ol>
  <ol type="i"><li>罗马数字</li><li>第二项</li><li>第三项</li></ol>
`;

const table = `
  <table>
    <thead><tr><th>商品</th><th width="60">数量</th><th width="80">金额</th></tr></thead>
    <tbody>
      <tr><td>咖啡豆 500g</td><td width="60">2</td><td width="80">¥ 136</td></tr>
      <tr><td>滤纸 100 张</td><td width="60">1</td><td width="80">¥ 18</td></tr>
      <tr><td colspan="2">合计（colspan 会告警并忽略）</td><td width="80"><b>¥ 154</b></td></tr>
    </tbody>
  </table>
`;

const images = `
  <p>行内小图 <img src="/images/test-square.png" width="18" height="18"> 与文字同一行，基线对齐。</p>
  <p><img src="${localLandscape}" width="240"></p>
`;

const code = `
  <pre>
function add(a, b) {
	return a + b;
}</pre>
  <p>H<sub>2</sub>O，E = mc<sup>2</sup></p>
  <blockquote>blockquote 左右各缩进 40px</blockquote>
  <hr>
  <p style="text-align:center;color:#999999">hr 之后</p>
`;

const scoped = '<p>页面 <span class="hl">scoped class</span> 能命中 rich-text 内部节点</p>';

// `<\/script>`: a literal closing tag would end this SFC's own <script> block
const untrusted =
  '<p>下面的 script / iframe 连同内容一起删掉，控制台各告警一次：</p><script>alert(1)<\/script><iframe src="https://example.com">iframe 里的字</iframe><p>（上面不应出现任何字）</p>';

const versions = [
  '<p>版本 <b>A</b>：点按钮切换 nodes，整段更新。</p>',
  '<h4>版本 B</h4><ul><li>换成了列表</li><li>两项</li></ul>',
];
const version = ref(0);

const taps = ref(0);

// 长文：spec 035 的真机对照内容。生成规则与
// packages/fjs-runtime/test/rich-text-node-budget.test.ts 的模拟长文同一份，
// 那边断言节点数，这边在设备上量耗时。
const article =
  '<h2>商品详情</h2>' +
  Array.from(
    { length: 30 },
    (_, i) =>
      `<p>第 ${i + 1} 段：这是一段<b>加粗</b>与<span style="color:#FA5151">红字</span>混排的说明文字，<i>斜体</i>收尾。</p>`,
  ).join('') +
  '<ul>' +
  Array.from({ length: 10 }, (_, i) => `<li>卖点 ${i + 1}</li>`).join('') +
  '</ul>' +
  '<table>' +
  Array.from({ length: 5 }, (_, r) => `<tr><td>规格 ${r}</td><td>值 ${r}</td><td>备注</td></tr>`).join('') +
  '</table>' +
  Array.from({ length: 3 }, () => '<p><img src="/images/test-square.png" width="120"></p>').join('');

const showArticle = ref(true);
const mountTimes = ref<number[]>([]);

/** JS 挂载耗时：翻转 v-if 到 flushNow() 返回。flushNow 是同步把帧交给宿主，
 * 所以数字里有 Vue 渲染 + 样式引擎 + op 编码 + Dart 应用帧，没有 Flutter 的
 * build / layout（那一半看性能面板的 ui）。真机上 GC 会让单次抖好几倍，看最小值。 */
async function remountArticle() {
  showArticle.value = false;
  await nextTick();
  flushNow();
  // No gc() here: it is a debugging tool, not something a page may call. So
  // a collection can land inside this window and inflate one sample — read
  // the minimum over several taps. The GC-free cost of the mount itself is
  // measured offline with fjsrun (docs/performance.md, rich-text 的节点数).
  const t0 = nowMs();
  showArticle.value = true;
  await nextTick();
  const t1 = nowMs();
  flushNow();
  const t2 = nowMs();
  const ms = t2 - t0;
  mountTimes.value = [...mountTimes.value, ms];
  // render = Vue patch + style engine + op encoding; bridge = the frame
  // handed to the host and applied, synchronously
  console.log(
    `[rich-text] article mount ${ms.toFixed(1)}ms (render ${(t1 - t0).toFixed(1)} · bridge ${(t2 - t1).toFixed(1)})`,
  );
}

function mountSummary(): string {
  const list = mountTimes.value;
  if (!list.length) return '点「重新挂载」开始计时';
  const last = list[list.length - 1];
  return `最近 ${last.toFixed(1)}ms · ${list.length} 次 min ${Math.min(...list).toFixed(1)}ms / max ${Math.max(...list).toFixed(1)}ms`;
}
</script>

<template>
  <view>
    <Panel title="HTML 字符串" desc="标题 / 段落 / 行内样式混排在同一行">
      <rich-text :nodes="basic" />
    </Panel>

    <Panel title="节点数组">
      <rich-text :nodes="nodes" />
    </Panel>

    <Panel title="space" desc="不设时连续空格折叠成一个">
      <view v-for="space in spaces" :key="space" class="space-row">
        <text class="space-label">{{ space || '不设' }}</text>
        <rich-text class="space-body" :nodes="spaceSample" :space="space || undefined" />
      </view>
    </Panel>

    <Panel title="列表">
      <rich-text :nodes="lists" />
    </Panel>

    <Panel title="表格" desc="退化成 flex 网格">
      <rich-text :nodes="table" />
    </Panel>

    <Panel title="图片">
      <rich-text :nodes="images" />
    </Panel>

    <Panel title="pre / 上下标 / blockquote / hr">
      <rich-text :nodes="code" />
    </Panel>

    <Panel title="scoped class">
      <rich-text :nodes="scoped" />
    </Panel>

    <Panel title="非白名单标签">
      <rich-text :nodes="untrusted" />
    </Panel>

    <Panel title="切换 nodes / @tap">
      <rich-text class="tappable" :nodes="versions[version]" @tap="taps++" />
      <text class="muted">点上面的富文本：@tap {{ taps }} 次</text>
      <button size="mini" @tap="version = (version + 1) % versions.length">切换内容</button>
    </Panel>

    <Panel title="模板里嵌套 text" desc="text 里的 text 是同一段里的行内片段">
      <text>满 <text class="red">199</text> 减 30，<text class="bold">包邮</text></text>
    </Panel>

    <Panel title="长文" desc="30 段混排 + 列表 + 表格 + 图片；重新挂载测 JS 耗时">
      <view class="mount-bar">
        <button size="mini" @tap="remountArticle">重新挂载</button>
        <text class="muted mount-info">{{ mountSummary() }}</text>
      </view>
      <rich-text v-if="showArticle" :nodes="article" />
    </Panel>
  </view>
</template>

<style scoped>
.space-row {
  flex-direction: row;
  align-items: flex-start;
}
.space-label {
  width: 48px;
  font-size: 12px;
  color: #999999;
  line-height: 20px;
}
.space-body {
  flex-grow: 1;
}
.hl {
  color: #07c160;
  font-weight: bold;
}
.tappable {
  background-color: #f7f7f7;
  padding: 8px;
  border-radius: 6px;
}
.muted {
  font-size: 13px;
  color: #999999;
}
.red {
  color: #fa5151;
  font-weight: bold;
}
.bold {
  font-weight: bold;
}
.mount-bar {
  flex-direction: row;
  align-items: center;
  margin-bottom: 8px;
}
.mount-info {
  flex-grow: 1;
  margin-left: 8px;
}
</style>
