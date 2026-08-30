import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fjs } from 'fjs/vite';

export default defineConfig({
  plugins: [fjs(), vue()],
});
