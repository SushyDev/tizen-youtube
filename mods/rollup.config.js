import { string } from 'rollup-plugin-string';
import terser from '@rollup/plugin-terser';
import getBabelOutputPlugin from '@rollup/plugin-babel';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';
import json from '@rollup/plugin-json';

import { load } from '../tools/config.js';

const config = load();
const { version } = config;

// The userscript runs inside Cobalt, not the set's webview, so the floor is Cobalt's engine and
// not Tizen's Chromium. Verified pairs: Tizen 6.5 / node 12 / Cobalt 3.2.1, and Tizen 9 / node 18 /
// Cobalt 5.2.1. Everything between them is unverified.
//
// Chrome 63 is the target that has actually run on Cobalt 3.2.1. Cobalt's V8 is probably newer
// than that, but "probably" is not worth a black screen on a set we cannot reach — raise it only
// after measuring the engine with tools/engine-probe.js.
const ENGINE = 'Chrome 63';

export default {
    input: 'entry.js',
    output: {
        file: '../dist/userScript.js',
        format: 'iife',
        banner: `/* tube ${version} */`
    },
    plugins: [
        json(),
        string({ include: '**/*.css' }),
        nodeResolve({ browser: true, preferBuiltins: false }),
        commonjs({
            include: [/node_modules/, /mods/],
            transformMixedEsModules: true
        }),
        replace({
            preventAssignment: true,
            values: {
                __TUBE_DEV_TOOLS__: process.env.TUBE_DEV === '1' ? 'on' : 'off',
                __TUBE_ORIGIN__: config.origin,
                __TUBE_VERSION__: version,
                __TUBE_BUNDLE__: 'userScript'
            }
        }),
        getBabelOutputPlugin({
            babelHelpers: 'bundled',
            presets: [['@babel/preset-env', { targets: ENGINE }]]
        }),
        terser({ ecma: 2017, mangle: true }),
        replace({
            preventAssignment: false,
            delimiters: ['', ''],
            values: { '\uFFFF': '\u0000' }
        })
    ]
};
