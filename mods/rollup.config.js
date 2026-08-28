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

// Two bundles from one source. Legacy support in a browser bundle is not free the way
// it is in a Node service: core-js, the fetch polyfill and ES5 downlevelling are parsed
// and executed on every launch, so only the TVs that need them get them.
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
    bundle({ name: 'modern', input: 'entry.modern.js', target: 'Chrome 63', ecma: 2017 }),
    bundle({ name: 'legacy', input: 'entry.legacy.js', target: 'Chrome 47', ecma: 5 })
];
