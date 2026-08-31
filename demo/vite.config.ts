import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fjs } from '@ufjs/cli/vite';

export default defineConfig({
  plugins: [fjs(), vue()],
  // Same dist/web as `fjs build --web`, so a web build does not empty dist/
  // out from under the Flutter bundle from `fjs build`.
  build: { outDir: 'dist/web' },
});
