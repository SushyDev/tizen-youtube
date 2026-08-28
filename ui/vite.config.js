import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import presetEnv from 'postcss-preset-env';

import { gridGap } from '../tools/postcss-grid-gap.mjs';
import { devService } from './dev/service.js';
import { tubeService, PROXY_PORT } from './dev/tube.js';

// Three ways to run this, differing only in what answers /__tube:
//
//   npm run dev                 the real service, here
//   TUBE_TV=<ip> npm run dev    a television; Vite proxies to the service on it
//   npm run dev:boot            a stand-in that answers with each boot.js scenario
const TV = process.env.TUBE_TV || '';
const SCENARIOS = !TV && process.env.TUBE_BOOT === 'scenarios';
const LOCAL = !TV && !SCENARIOS;

// The boot screen lands in the same webview the Homebrew channel's pages do (Chromium
// 63 on Tizen 5.5, 76 on 6.5) and fails the same silent way, so it is written in modern
// CSS, lowered by PostCSS, and checked by the build. See tools/css-support.js.
const ENGINE = 'chrome >= 63';

export default defineConfig({
    css: {
        postcss: {
            plugins: [presetEnv({
                browsers: ENGINE,
                features: {
                    'nesting-rules': true,
                    'custom-media-queries': true,
                    'custom-properties': false,
                    'focus-visible-pseudo-class': false,
                    'focus-within-pseudo-class': false
                }
            }),

            // `gap` is `grid-gap` until Chromium 66. See the plugin.
            gridGap()]
        }
    },

    // One file: the app's start page must not depend on a second request resolving.
    plugins: [
        viteSingleFile(),

        // The real service, off-TV. Development only.
        tubeService({ enabled: LOCAL }),

        // The stand-in, for looking at the boot screen itself.
        devService({ enabled: SCENARIOS })
    ],

    server: {
        host: true,
        // The stand-in answers from inside Vite; the other two are a service on a port.
        proxy: SCENARIOS ? undefined : {
            '/__tube': { target: `http://${TV || 'localhost'}:${PROXY_PORT}`, changeOrigin: true }
        }
    },

    build: {
        outDir: 'dist',
        target: 'chrome63',
        cssTarget: 'chrome63',
        cssMinify: true,
        reportCompressedSize: true
    }
});
