'use strict';

// googlevideo is ESM only, and ncc leaves it as a bare `require` that resolves to nothing
// on the television. Rolling it up to CommonJS first gives ncc an ordinary file to inline,
// and keeps the dependency pinned at build time rather than resolved at runtime.

const { rollup } = require('rollup');
const { nodeResolve } = require('@rollup/plugin-node-resolve');
const commonjs = require('@rollup/plugin-commonjs');
const { join } = require('path');
const { mkdirSync, existsSync } = require('fs');

const root = join(__dirname, '..');
const outDir = join(root, 'vendor');
const outFile = join(outDir, 'googlevideo.cjs');

// One entry re-exporting only what the service uses, so the bundle carries no more than
// the SABR path needs.
const ENTRY = join(__dirname, 'vendor-entry.mjs');

async function build() {
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

    const bundle = await rollup({
        input: ENTRY,
        plugins: [nodeResolve({ preferBuiltins: true }), commonjs()],
        // Node's own modules stay external; everything else is inlined.
        external: (id) => id.startsWith('node:') || require('module').builtinModules.includes(id)
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
