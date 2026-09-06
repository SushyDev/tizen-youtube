import { builtinModules } from 'module';
import { defineConfig } from 'vite';

// One self-contained CommonJS file for the set's own Node. The floor is node 12 — Tizen 6.5,
// verified on hardware — and `tools/check-output.js` parses the result at ES2019 to prove the
// syntax really came down that far.
const NODE_BUILTINS = builtinModules.flatMap((name) => [name, `node:${name}`]);

export default defineConfig({
    resolve: {
        // node-fetch v2 ships both, and its ESM copy is what the bundler prefers. Wrapped back
        // into CommonJS that becomes a namespace object, so `require('node-fetch')` yields
        // `{ default: fetch }` and every call site throws "fetch is not a function" — on the set,
        // where nothing is watching. Name the CommonJS entry and the interop question disappears.
        alias: { 'node-fetch': 'node-fetch/lib/index.js' }
    },

    // Nothing here is a web app; without this Vite looks for an index.html.
    appType: 'custom',

    build: {
        target: 'node12',
        outDir: 'dist',

        // The reason this is worth having: a dependency removed from package.json used to leave its
        // assets behind in dist/ and they shipped anyway.
        emptyOutDir: true,

        // The service is read on a television when something has gone wrong. Keep it readable.
        minify: false,
        sourcemap: false,
        reportCompressedSize: false,

        ssr: 'index.js',

        // Nothing here imports dynamically, so this is one chunk without being asked.
        rollupOptions: {
            external: NODE_BUILTINS,
            output: {
                format: 'cjs',
                entryFileNames: 'index.js',
                // Tizen's service runner calls onStart/onRequest/onStop on our exports.
                exports: 'named'
            }
        }
    },

    // express, cors and node-fetch have to travel with it — the set has no node_modules.
    ssr: { noExternal: true }
});
