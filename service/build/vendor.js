'use strict';

// googlevideo is ESM only, and ncc leaves it as a bare `require` that resolves to nothing
// on the television. Rolling it up to CommonJS first gives ncc an ordinary file to inline.

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

        // Rollup answers an import it cannot resolve by leaving it external and warning, so a
        // missing dependency writes a stub of bare requires, exits 0, and ncc inlines a bundle
        // that dies on its first require — a television that waits 20s and shows a black screen.
        // Fail here instead, where the message is readable.
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
