import { builtinModules } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

const HERE = dirname(fileURLToPath(import.meta.url));

const NODE_BUILTINS = builtinModules.flatMap((name) => [name, `node:${name}`]);

// TUBE_DEV=1 keeps the bridge, the journal, the dev routes and the page hooks. Without it they
// are swapped for an inert stub and never enter the bundle at all — which is also what takes
// `cors` out, since nothing else requires it.
const DEV = process.env.TUBE_DEV === '1';

export default defineConfig({
    resolve: {
        // The CommonJS entry, because the bundled ESM copy becomes a `{ default }` namespace and
        // every fetch() call throws.
        alias: Object.assign(
            { 'node-fetch': 'node-fetch/lib/index.js' },
            // Absolute, so both spellings — ./dev/index.js from index.js and ../dev/index.js
            // from lib/ — resolve to the one stub rather than to two copies of it.
            DEV ? {} : {
                './dev/index.js': join(HERE, 'dev', 'none.js'),
                '../dev/index.js': join(HERE, 'dev', 'none.js')
            }
        )
    },

    build: {
        target: 'node12',
        outDir: 'dist',

        // Unminified so the bundle can be read on the television when something has gone wrong.
        minify: false,
        sourcemap: false,
        reportCompressedSize: false,

        ssr: 'index.js',

        rolldownOptions: {
            external: NODE_BUILTINS,
            output: {
                format: 'cjs',
                entryFileNames: 'index.js'
            }
        }
    },

    // express, cors and node-fetch have to travel with it — the set has no node_modules.
    ssr: { noExternal: true }
});
