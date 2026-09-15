import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fjs } from '@ufjs/cli/vite';

export default defineConfig({
  plugins: [fjs(), vue()],
  // Same dist/web as `fjs build --web`, so a web build does not empty dist/
  // out from under the Flutter bundle from `fjs build`.
  build: { outDir: 'dist/web' },
  // .glb is this project's asset (the three.js model, spec 023), not
  // something every fjs project ships — the CLI's baseline stays clean and
  // a project declares its own extras here. esbuild's build gets the same
  // extension from ASSET_LOADERS in the CLI.
  assetsInclude: ['**/*.glb'],
  // Vite ignores $PORT on its own; honour it so a launcher that assigns a
  // port (e.g. a second dev server beside one already on 5173) can use it.
  server: { port: Number(process.env.PORT) || undefined },
});
