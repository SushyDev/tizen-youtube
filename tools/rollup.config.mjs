import { string } from 'rollup-plugin-string';
import terser from '@rollup/plugin-terser';
import getBabelOutputPlugin from '@rollup/plugin-babel';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';
import json from '@rollup/plugin-json';

import { load, gitStamp } from './config.js';

const config = load();
const { version } = config;
const { commit, tree } = gitStamp();

const ENGINE = 'Chrome 63';
const ECMA = 2017;

export default {
    input: 'mods/index.js',
    output: {
        file: 'dist/userScript.js',
        format: 'iife',
        banner: `/* tube ${version} */`
    },
    plugins: [
        json(),
        string({ include: '**/*.css' }),
        nodeResolve({ browser: true, preferBuiltins: false }),
        // Narrowed to node_modules: nothing under framework/ or mods/ is CommonJS, and running
        // the interop transform over first-party ESM makes it less statically analysable than
        // leaving it alone.
        commonjs({ include: [/node_modules/] }),
        replace({
            preventAssignment: true,
            values: {
                __TUBE_DEV_TOOLS__: process.env.TUBE_DEV === '1' ? 'on' : 'off',
                __TUBE_ORIGIN__: config.origin,
                __TUBE_VERSION__: version,
                __TUBE_COMMIT__: commit,
                __TUBE_TREE__: process.env.ROLLUP_WATCH === 'true' ? 'watch' : tree
            }
        }),
        getBabelOutputPlugin({
            babelHelpers: 'bundled',
            presets: [['@babel/preset-env', { targets: ENGINE }]]
        }),
        terser({ ecma: ECMA, mangle: true }),
        replace({
            preventAssignment: false,
            delimiters: ['', ''],
            values: { '\uFFFF': '\u0000' }
        })
    ]
};
