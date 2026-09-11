<route>
{"title": "富文本", "tag": "rich-text", "group": "基础内容"}
</route>

<script setup lang="ts">
// rich-text：nodes 是 HTML 字符串或节点数组，白名单、默认样式、列表编号、
// 表格退化都在 JS 里（components/rich-text.ts），两端同一份。
// 这一页也是 spec 034 的对拍页：web 与 iOS 并排截图比段落数 / 列表项数 / 图片数。
import { ref } from 'vue';
import type { RichTextNode } from 'fjs';
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
</style>
