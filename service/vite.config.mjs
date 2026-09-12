import { builtinModules, createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import babel from '@babel/core';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const NODE_BUILTINS = builtinModules.flatMap((name) => [name, `node:${name}`]);

// TUBE_DEV=1 keeps the bridge, the journal, the dev routes and the page hooks. Without it they
// are swapped for an inert stub and never enter the bundle at all — which is also what takes
// `cors` out, since nothing else requires it.
const DEV = process.env.TUBE_DEV === '1';

// TUBE_TARGET=legacy builds the legacy widget's service, for node 4.4.3.
const LEGACY = process.env.TUBE_TARGET === 'legacy';

const LEGACY_ENTRY = join(HERE, 'legacy', 'index.js');
const HTTP2_STANDIN = join(HERE, 'legacy', 'http2.js');
const URL_STANDIN = join(HERE, 'legacy', 'url.js');

const polyfilled = (code) => babel.transformSync(code, {
    babelrc: false,
    configFile: false,
    sourceType: 'script',
    presets: [['@babel/preset-env', {
        targets: { node: '4.4.3' },
        useBuiltIns: 'entry',
        corejs: require('core-js/package.json').version
    }]]
}).code;

// Narrows core-js to node 4.4.3's gaps, makes http2 optional and parses URLs the way node 4 can;
// build-service.js lowers to ES5.
const legacy = {
    name: 'tube-legacy',
    enforce: 'pre',
    resolveId: (source, importer) => {
        if (source === 'whatwg-url') return URL_STANDIN;
        if (source !== 'http2' && source !== 'node:http2') return null;
        return importer === HTTP2_STANDIN ? { id: 'http2', external: true } : HTTP2_STANDIN;
    },
    transform: (code, id) => (id === LEGACY_ENTRY ? { code: polyfilled(code), map: null } : null)
};

export default defineConfig({
    plugins: LEGACY ? [legacy] : [],

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
            },
            LEGACY ? { './carrier.js': join(HERE, 'legacy', 'carrier.js') } : {}
        )
    },

    build: {
        target: 'node12',
        outDir: LEGACY ? 'dist-legacy' : 'dist',

        // Unminified so the bundle can be read on the television when something has gone wrong.
        minify: false,
        sourcemap: false,
        reportCompressedSize: false,

        ssr: LEGACY ? 'legacy/index.js' : 'index.js',

        rolldownOptions: {
            // Externals skip resolveId, so http2 must leave the list.
            external: LEGACY ? NODE_BUILTINS.filter((name) => !/^(node:)?http2$/.test(name)) : NODE_BUILTINS,
            output: {
                format: 'cjs',
                entryFileNames: 'index.js'
            }
        }
    },

    // express, cors and node-fetch have to travel with it — the set has no node_modules.
    ssr: { noExternal: true }
});
