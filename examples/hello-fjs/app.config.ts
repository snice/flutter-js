import { defineConfig } from '@ufjs/cli/config';

export default defineConfig({
    android: {
        permissions: ['android.permission.INTERNET']
    },
    wxmp: {
        appid: 'wx55831603b568aa90',
        renderer: 'skyline'
    }
});