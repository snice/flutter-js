import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fjs } from '@ufjs/cli/vite';

export default defineConfig({
  plugins: [fjs(), vue()],
  // 与 `fjs build --web` 同一个输出目录，web 构建不会清掉 Flutter 包
  build: { outDir: 'dist/web' },
  // 车和房子的模型；esbuild 那条流水线由 CLI 的 ASSET_LOADERS 认 .glb
  assetsInclude: ['**/*.glb'],
});
