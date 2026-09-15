import { defineConfig } from '@ufjs/cli/config';

export default defineConfig({
    version: '1.0.0+2',
    orientation: 'landscape',
    android: {
        permissions: ['android.permission.INTERNET']
    },
});
