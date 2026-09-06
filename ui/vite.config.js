import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import presetEnv from 'postcss-preset-env';

import { gridGap } from '../tools/postcss-grid-gap.mjs';
import { devService } from './dev/service.js';
import { tubeService, PROXY_PORT } from './dev/tube.js';

const TV = process.env.TUBE_TV || '';
const SCENARIOS = !TV && process.env.TUBE_BOOT === 'scenarios';
const LOCAL = !TV && !SCENARIOS;

// The boot screen runs in the set's own webview, and only in a TUBE_COBALT_CONTAINER=off
// build. Chromium 63 is what has shipped and run; the fallback path is not worth a risk.
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

            gridGap()]
        }
    },

    plugins: [
        viteSingleFile(),

        tubeService({ enabled: LOCAL }),

        devService({ enabled: SCENARIOS })
    ],

    server: {
        host: true,
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
