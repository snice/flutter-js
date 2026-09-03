import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyzePageNodes, firstFrameNodeWarnings } from '../src/bundler/node-budget.js';
import { scanPages } from '../src/project/pages.js';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-node-budget-'));
  write('package.json', JSON.stringify({ name: 'app' }));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function write(file: string, contents: string): string {
  const full = path.join(root, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
  return full;
}

function page(rel: string, source: string): void {
  write(`src/pages/${rel}`, source);
}

describe('first-frame node budget', () => {
  it('does not warn for a small static page', () => {
    page('index.vue', '<template><view><text>Hello</text></view></template>\n');

    expect(firstFrameNodeWarnings(root, scanPages(root))).toEqual([]);
  });

  it('warns when a static v-for page exceeds the default budget', () => {
    page(
      'index.vue',
      `<script setup lang="ts">
const rows = Array.from({ length: 260 }, (_, i) => i);
</script>
<template>
  <scroll-view>
    <view v-for="row in rows" :key="row">
      <text>{{ row }}</text>
    </view>
  </scroll-view>
</template>
`,
    );

    const warnings = analyzePageNodes(root, scanPages(root));
    expect(warnings).toHaveLength(1);
    expect(warnings[0].nodes).toBe(521);
    expect(warnings[0].text).toContain('[fjs perf] src/pages/index.vue');
    expect(warnings[0].text).toContain('budget 500');
  });

  it('uses fjs.performance.nodeBudget from package.json', () => {
    write(
      'package.json',
      JSON.stringify({ name: 'app', fjs: { performance: { nodeBudget: 600 } } }),
    );
    page(
      'index.vue',
      `<script setup lang="ts">
const rows = Array.from({ length: 260 }, (_, i) => i);
</script>
<template><view><view v-for="row in rows" :key="row"><text>{{ row }}</text></view></view></template>
`,
    );

    expect(firstFrameNodeWarnings(root, scanPages(root))).toEqual([]);
  });

  it('carries computed Array.from lengths through local child components', () => {
    write(
      'src/components/Rows.vue',
      `<script setup lang="ts">
defineProps<{ items: number[] }>();
</script>
<template>
  <view>
    <view v-for="item in items" :key="item">
      <text>{{ item }}</text>
      <text>meta</text>
    </view>
  </view>
</template>
`,
    );
    page(
      'index.vue',
      `<script setup lang="ts">
import { computed, ref } from 'vue';
import Rows from '../components/Rows.vue';

const rows = ref(200);
const visible = ref(true);
const items = computed(() => Array.from({ length: rows.value }, (_, i) => i));
</script>
<template>
  <view>
    <Rows v-if="visible" :items="items" />
    <view v-else><text>empty</text></view>
  </view>
</template>
`,
    );

    const [warning] = analyzePageNodes(root, scanPages(root));
    expect(warning.nodes).toBe(602);
  });
});
