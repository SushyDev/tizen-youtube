import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import presetEnv from 'postcss-preset-env';

import { gridGap } from '../tools/postcss-grid-gap.mjs';
import { devService } from './dev/service.js';
import { tubeService, PROXY_PORT } from './dev/tube.js';

// Three ways to run this, and they differ only in what answers /__tube.
//
//   npm run dev            the real service, here. The boot screen hands over
//                          and youtube.com's TV client comes up through the
//                          real proxy with the real userscript in it — which
//                          is how a feature gets worked on without hardware.
//
//   TUBE_TV=<ip> npm run dev
//                          a television. Vite proxies to the service running
//                          on it, so the boot screen is developed against the
//                          state a real set reports.
//
//   npm run dev:boot       dev/service.js, a stand-in that answers with each
//                          scenario boot.js can meet and never hands over —
//                          the only way to look at a screen whose whole
//                          purpose is to disappear. See ?boot= in that file.
const TV = process.env.TUBE_TV || '';
const SCENARIOS = !TV && process.env.TUBE_BOOT === 'scenarios';
const LOCAL = !TV && !SCENARIOS;

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

        // The real service, off-TV. Development only.
        tubeService({ enabled: LOCAL }),

        // The stand-in, for looking at the boot screen itself.
        devService({ enabled: SCENARIOS })
    ],

    server: {
        host: true,
        // The stand-in answers from inside Vite; the other two are a service
        // on a port, here or on the television.
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
