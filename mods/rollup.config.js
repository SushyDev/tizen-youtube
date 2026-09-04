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

function bundle({ name, input, target, ecma }) {
    return {
        input,
        output: {
            file: `../dist/userScript.${name}.js`,
            format: 'iife',
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
            replace({
                preventAssignment: false,
                delimiters: ['', ''],
                values: { '\uFFFF': '\u0000' }
            })
        ]
    };
}

export default [
    bundle({ name: 'modern', input: 'entry.modern.js', target: 'Chrome 63', ecma: 2017 }),
    bundle({ name: 'legacy', input: 'entry.legacy.js', target: 'Chrome 47', ecma: 5 })
];
