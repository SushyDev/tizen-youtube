'use strict';

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
    CustomEvent: 'readonly',
    MutationObserver: 'readonly',
    IntersectionObserver: 'readonly',
    KeyboardEvent: 'readonly',
    DOMRect: 'readonly',
    getComputedStyle: 'readonly',
    requestAnimationFrame: 'readonly',
    cancelAnimationFrame: 'readonly',
    HTMLScriptElement: 'readonly',
    Reflect: 'readonly',
    atob: 'readonly',
    btoa: 'readonly',
    tizen: 'readonly',
    webapis: 'readonly'
};

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


// The shape the shipped code is held to: const only, no loops, no classes, and no anonymous block
// wearing a variable's name. Nothing enforced these until 2026-09-06 and the code drifted for it.
//
// Four files are exempt because live sibling branches own them and a reshape here would conflict
// on every restack. They are the follow-up, not an exception in principle.
const SIBLING_OWNED = [
    'mods/ui/customUI.js',
    'mods/features/pictureInPicture.js',
    'mods/ui/settingsModel.js',
    'mods/youtube/commands.js'
];

const SHIPPED = ['service/**/*.js', 'mods/**/*.js', 'ui/src/**/*.js'];

const NOT_SHIPPED = SIBLING_OWNED.concat([
    'service/test/**/*.js',
    'mods/test/**/*.js',
    'service/build/**/*.js',
    'service/vite.config.mjs',
    'mods/rollup.config.js'
]);

const STYLE_RULES = {
    'no-var': 'error',
    'prefer-const': ['error', { destructuring: 'all' }],
    'no-restricted-syntax': ['error',
        { selector: "VariableDeclaration[kind='let']", message: 'const only — hold what changes in one named record' },
        { selector: 'ForStatement', message: 'use map/filter/reduce/find, or recursion' },
        { selector: 'ForOfStatement', message: 'use map/filter/reduce/find, or recursion' },
        { selector: 'ForInStatement', message: 'use Object.keys' },
        { selector: 'WhileStatement', message: 'use map/filter/reduce/find, or recursion' },
        { selector: 'DoWhileStatement', message: 'use map/filter/reduce/find, or recursion' },
        { selector: 'ClassDeclaration', message: 'use a factory function that closes over its state' },
        { selector: 'ClassExpression', message: 'use a factory function that closes over its state' },
        { selector: 'CallExpression > ArrowFunctionExpression.callee', message: 'name it — a function-scoped helper, not an IIFE' },
        { selector: 'CallExpression > FunctionExpression.callee', message: 'name it — a function-scoped helper, not an IIFE' }
    ]
};

module.exports = [
    {
        ignores: [
            '**/node_modules/**',
            '**/dist/**',
            '**/release/**',
            '**/.package/**',
            'mods/tiny-sha256.js'
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
        files: SHIPPED,
        ignores: NOT_SHIPPED,
        rules: STYLE_RULES
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
        files: [
            'ui/dev/**/*.js',
            'ui/vite.config.js',
            'ui/build.js'
        ],
        ignores: ['ui/dev/remote.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: NODE_GLOBALS
        },
        rules: CORRECTNESS_RULES
    }
];
