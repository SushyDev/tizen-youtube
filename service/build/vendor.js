'use strict';

// googlevideo is ESM only; ncc leaves it as a bare `require` that resolves to nothing on the TV.

const { rollup } = require('rollup');
const { nodeResolve } = require('@rollup/plugin-node-resolve');
const commonjs = require('@rollup/plugin-commonjs');
const { join } = require('path');
const { mkdirSync, existsSync } = require('fs');

const root = join(__dirname, '..');
const outDir = join(root, 'vendor');
const outFile = join(outDir, 'googlevideo.cjs');

const ENTRY = join(__dirname, 'vendor-entry.mjs');

async function build() {
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

    const bundle = await rollup({
        input: ENTRY,
        plugins: [nodeResolve({ preferBuiltins: true }), commonjs()],
        external: (id) => id.startsWith('node:') || require('module').builtinModules.includes(id),

        // Rollup only warns on an unresolved import: without this the build exits 0 and ships
        // a bundle that dies on its first require.
        onwarn(warning) {
            if (warning.code === 'UNRESOLVED_IMPORT') {
                throw new Error(`${warning.exporter} could not be resolved — run npm install`);
            }

            console.warn(`      ${warning.message}`);
        }
    });

    const { output } = await bundle.write({ file: outFile, format: 'cjs', exports: 'named' });
    await bundle.close();

    return output[0].code.length;
}

build().then(
    (bytes) => console.log(`      vendor/googlevideo.cjs  ${Math.round(bytes / 1024)}kB`),
    (error) => {
        console.error(`      could not bundle googlevideo: ${error.message}`);
        process.exit(1);
    }
);
