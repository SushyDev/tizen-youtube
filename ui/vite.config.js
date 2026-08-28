import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import presetEnv from 'postcss-preset-env';

import { gridGap } from '../tools/postcss-grid-gap.mjs';
import { devService } from './dev/service.js';

// The TV to develop against. Without one, dev/service.js answers instead and
// the boot log holds on screen rather than handing over — which is the only
// way to look at a screen whose whole purpose is to disappear.
const TV = process.env.TUBE_TV || '';

// The boot screen is one page, but it lands in the same webview the Homebrew
// channel's pages do — Chromium 63 on Tizen 5.5, 76 on 6.5 — and fails the same silent
// way: an at-rule it cannot parse takes the whole stylesheet with it. So it
// gets the same treatment: written in modern CSS, lowered by PostCSS, and
// checked by the build before it can ship. See tools/css-support.js.
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

    // One file: the app's start page has to work before anything else does,
    // so it should not depend on a second request resolving.
    plugins: [
        viteSingleFile(),

        // Development only, and only when there is no TV to talk to.
        devService({ enabled: !TV })
    ],

    server: {
        host: true,
        proxy: TV ? { '/__tube': { target: `http://${TV}:8099`, changeOrigin: true } } : undefined
    },

    build: {
        outDir: 'dist',
        target: 'chrome63',
        cssTarget: 'chrome63',
        cssMinify: true,
        reportCompressedSize: true
    }
});
