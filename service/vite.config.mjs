import { builtinModules, createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import babel from '@babel/core';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const NODE_BUILTINS = builtinModules.flatMap((name) => [name, `node:${name}`]);

// Without it the dev modules resolve to an inert stub and never enter the bundle, taking `cors`
// with them.
const DEV = process.env.TUBE_DEV === '1';

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

// Narrows core-js to node 4.4.3's gaps, makes http2 optional and parses URLs the way node 4 can.
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

// Below node 14 node-fetch's per-socket close listeners pile up on kept-alive sockets and fire
// "Premature close" on finished bodies.
const PER_SOCKET_CLOSE = 'parseInt(process.version.substring(1)) < 14';
const NODE_FETCH = /node-fetch[\\/]lib[\\/]index\.js$/;

const staleCloseListeners = {
    name: 'tube-node-fetch-close',
    transform: (code, id) => {
        if (!NODE_FETCH.test(id)) return null;
        if (code.indexOf(PER_SOCKET_CLOSE) === -1) throw new Error(`node-fetch changed: ${PER_SOCKET_CLOSE} is gone`);

        return { code: code.replace(PER_SOCKET_CLOSE, 'false'), map: null };
    }
};

export default defineConfig({
    plugins: LEGACY ? [legacy, staleCloseListeners] : [staleCloseListeners],

    resolve: {
        // The CommonJS entry: the bundled ESM copy becomes a `{ default }` namespace and every
        // fetch() call throws.
        alias: Object.assign(
            { 'node-fetch': 'node-fetch/lib/index.js' },
            // Absolute, so both spellings resolve to the one stub rather than two copies of it.
            DEV ? {} : {
                './dev/index.js': join(HERE, 'dev', 'none.js'),
                '../dev/index.js': join(HERE, 'dev', 'none.js')
            }
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
