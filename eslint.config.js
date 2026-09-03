'use strict';

// Correctness linting only, no style opinions. `node --check` validates syntax but
// not references, so an undeclared constant ships happily and fails at runtime.

const NODE_GLOBALS = {
    require: 'readonly',
    module: 'writable',
    exports: 'writable',
    process: 'readonly',
    console: 'readonly',
    Buffer: 'readonly',
    __dirname: 'readonly',
    __filename: 'readonly',
    setTimeout: 'readonly',
    clearTimeout: 'readonly',
    setInterval: 'readonly',
    clearInterval: 'readonly',
    fetch: 'readonly',
    AbortSignal: 'readonly',
    URL: 'readonly',
    URLSearchParams: 'readonly',
    TextDecoder: 'readonly',
    TextEncoder: 'readonly',
    global: 'readonly'
};

const BROWSER_GLOBALS = {
    window: 'readonly',
    document: 'readonly',
    navigator: 'readonly',
    location: 'writable',
    fetch: 'readonly',
    XMLHttpRequest: 'readonly',
    WebSocket: 'readonly',
    Headers: 'readonly',
    Request: 'readonly',
    Response: 'readonly',
    URL: 'readonly',
    Intl: 'readonly',
    console: 'readonly',
    setTimeout: 'readonly',
    clearTimeout: 'readonly',
    setInterval: 'readonly',
    clearInterval: 'readonly',
    localStorage: 'readonly',
    Element: 'readonly',
    Event: 'readonly',
    EventTarget: 'readonly',
    CustomEvent: 'readonly',
    MediaSource: 'readonly',
    MutationObserver: 'readonly',
    IntersectionObserver: 'readonly',
    KeyboardEvent: 'readonly',
    DOMRect: 'readonly',
    getComputedStyle: 'readonly',
    requestAnimationFrame: 'readonly',
    cancelAnimationFrame: 'readonly',
    HTMLImageElement: 'readonly',
    HTMLScriptElement: 'readonly',
    Reflect: 'readonly',
    atob: 'readonly',
    btoa: 'readonly',
    // Provided by the Tizen platform inside the TV's webview and services.
    tizen: 'readonly',
    webapis: 'readonly'
};

// Imported directly by the Vite build, so ES modules rather than CommonJS like the
// rest of tools/. Vite's config loader would otherwise read a bare .js as CommonJS.
const SHARED_ES_MODULES = ['tools/css-support.js', 'tools/postcss-grid-gap.mjs'];

const CORRECTNESS_RULES = {
    'no-undef': 'error',
    'no-dupe-keys': 'error',
    'no-dupe-args': 'error',
    'no-duplicate-case': 'error',
    'no-unreachable': 'error',
    'no-const-assign': 'error',
    'no-self-assign': 'error',
    'no-func-assign': 'error',
    'no-obj-calls': 'error',
    'no-sparse-arrays': 'error',
    // Missing a `break` is the exact bug the reference shipped, where a file install
    // fell through and wiped the signing certificates.
    'no-fallthrough': 'error',
    'use-isnan': 'error',
    'valid-typeof': 'error',
    'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }]
};

module.exports = [
    {
        ignores: [
            '**/node_modules/**',
            '**/dist/**',
            '**/release/**',
            '**/.ncc/**',
            '**/.package/**',
            // Vendored upstream code is not ours to lint.
            'mods/tiny-sha256.js',
            'service/vendor/**'
        ]
    },
    {
        // Build tooling and the on-TV service.
        files: ['tools/**/*.js', 'service/**/*.js'],
        ignores: SHARED_ES_MODULES,
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: Object.assign({}, NODE_GLOBALS, { tizen: 'readonly', webapis: 'readonly' })
        },
        rules: CORRECTNESS_RULES
    },
    {
        // The userscript, which is ES modules running in the TV's browser.
        files: ['mods/**/*.js'],
        ignores: ['mods/test/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: BROWSER_GLOBALS
        },
        rules: CORRECTNESS_RULES
    },
    {
        // The bundler's own configuration sits among the modification's files but runs in
        // Node, so it reads the environment the way a build script does.
        files: ['mods/rollup.config.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: NODE_GLOBALS
        },
        rules: CORRECTNESS_RULES
    },
    {
        // Its tests, which run in Node rather than in a television.
        files: ['mods/test/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: NODE_GLOBALS
        },
        rules: CORRECTNESS_RULES
    },
    {
        // Read by the Vite build, so these are ES modules like it is.
        files: SHARED_ES_MODULES,
        languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
        rules: CORRECTNESS_RULES
    },
    {
        // The boot screen: ES modules, bundled by Vite.
        files: ['ui/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: Object.assign({}, BROWSER_GLOBALS, {
                WebSocket: 'readonly',
                XMLHttpRequest: 'readonly',
                HTMLElement: 'readonly',
                FileReader: 'readonly',
                // Vite replaces import.meta.env at build time.
                process: 'readonly'
            })
        },
        rules: CORRECTNESS_RULES
    },
    {
        // Sits in the UI folder but runs in Node, so it gets Node's globals — `Buffer`
        // above all. After the pages block, so it wins for the files it names.
        files: [
            'ui/dev/**/*.js',
            'ui/vite.config.js',
            'ui/build.js'
        ],
        // The dev remote is browser code, so it keeps the globals from the block above.
        ignores: ['ui/dev/remote.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: NODE_GLOBALS
        },
        rules: CORRECTNESS_RULES
    }
];
