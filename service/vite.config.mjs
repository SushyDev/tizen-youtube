import { builtinModules } from 'module';
import { defineConfig } from 'vite';

const NODE_BUILTINS = builtinModules.flatMap((name) => [name, `node:${name}`]);

export default defineConfig({
    resolve: {
        // The CommonJS entry, because the bundled ESM copy becomes a `{ default }` namespace and
        // every fetch() call throws.
        alias: { 'node-fetch': 'node-fetch/lib/index.js' }
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
