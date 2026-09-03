'use strict';

// Correctness linting only: `node --check` validates syntax but not references, so an
// undeclared constant ships happily and fails at runtime.

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

// ES modules rather than CommonJS like the rest of tools/, because Vite's config loader
// would otherwise read a bare .js as CommonJS.
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
        files: ['mods/rollup.config.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: NODE_GLOBALS
        },
        rules: CORRECTNESS_RULES
    },
    {
        files: ['mods/test/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: NODE_GLOBALS
        },
        rules: CORRECTNESS_RULES
    },
    {
        files: SHARED_ES_MODULES,
        languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
        rules: CORRECTNESS_RULES
    },
    {
        files: ['ui/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: Object.assign({}, BROWSER_GLOBALS, {
                WebSocket: 'readonly',
                XMLHttpRequest: 'readonly',
                HTMLElement: 'readonly',
                FileReader: 'readonly',
                process: 'readonly'
            })
        },
        rules: CORRECTNESS_RULES
    },
    {
        // Node rather than browser globals. After the block above, so it wins the overlap.
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
