import { defineConfig } from '@ufjs/cli/config';

export default defineConfig({
    version: '1.0.0+2',
    android: {
        permissions: ['android.permission.INTERNET']
    },
    wxmp: {
        appid: 'wx55831603b568aa90',
        renderer: 'skyline',
        "setting": {
            "es6": true,
            "postcss": false,
            "minified": true,
            "minifyWXSS": true,
            "minifyWXML": true,
        }
    }
});