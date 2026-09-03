import { string } from 'rollup-plugin-string';
import terser from '@rollup/plugin-terser';
import getBabelOutputPlugin from '@rollup/plugin-babel';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';
import json from '@rollup/plugin-json';

import { load } from '../tools/config.js';

const config = load();
const version = config.version;

// One bundle. It is still named `modern`, and latest.json still describes it under that
// key, because an app already installed looks its own bundle up by that name — renaming
// it would strand every set that has not updated yet on its shipped script.
function bundle({ name, input, target, ecma }) {
    return {
        input,
        output: {
            file: `../dist/userScript.${name}.js`,
            format: 'iife',
            // A stable banner makes it obvious which bundle a TV actually got.
            banner: `/* tube ${version} (${name}) */`
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
                    // A release carries no development tooling: see mods/dev/tools.js.
                    __TUBE_DEV_TOOLS__: process.env.TUBE_DEV === '1' ? 'on' : 'off',
                    __TUBE_ORIGIN__: config.origin,
                    __TUBE_VERSION__: version,
                    __TUBE_BUNDLE__: name
                }
            }),
            getBabelOutputPlugin({
                babelHelpers: 'bundled',
                presets: [['@babel/preset-env', { targets: target }]]
            }),
            terser({ ecma, mangle: true }),
            // Restores the NUL byte carried as a sentinel through the string plugin.
            replace({
                preventAssignment: false,
                delimiters: ['', ''],
                values: { '\uFFFF': '\u0000' }
            })
        ]
    };
}

export default [
    bundle({ name: 'modern', input: 'entry.modern.js', target: 'Chrome 63', ecma: 2017 })
];
