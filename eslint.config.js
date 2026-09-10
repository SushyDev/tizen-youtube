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
    AbortController: 'readonly',
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
    Node: 'readonly',
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


// Style rules: const only, no loops, no classes, no IIFEs.
//
// These files are exempt because live sibling branches own them and a reshape here would conflict
// on every restack. They are the follow-up, not an exception in principle.
const SIBLING_OWNED = [
    'mods/player/pictureInPicture.js',
    'mods/commands/interpreters.js'
];

// Every layer, not only the ones that ship: the build scripts are read as often as the mods are.
const STYLED = [
    'service/**/*.js', 'framework/**/*.js', 'mods/**/*.js',
    'tools/**/*.js', 'tools/**/*.mjs'
];

// Tests are exempt.
const UNSTYLED = SIBLING_OWNED.concat([
    'service/test/**/*.js',
    'test/**/*.js'
]);

const FEED_CONTAINERS = [
    'tvBrowseRenderer', 'tvSurfaceContentRenderer', 'tvSurfaceContentContinuation',
    'sectionListRenderer', 'sectionListContinuation', 'horizontalListContinuation',
    'gridContinuation', 'tvSecondaryNavRenderer'
];

const NOT_THE_FEEDS_KEEPER = {
    selector: `MemberExpression[property.name=/^(${FEED_CONTAINERS.join('|')})$/]`,
    message: 'only mods/feed/surfaces.js descends to a feed container — register onTile/keepTile/'
        + 'onShelf/keepShelf/onSurface with the walk instead'
};

const STYLE_SELECTORS = [
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
];

const STYLE_RULES = {
    'no-var': 'error',
    'prefer-const': ['error', { destructuring: 'all' }],
    'no-restricted-syntax': ['error'].concat(STYLE_SELECTORS)
};

module.exports = [
    {
        ignores: [
            '**/node_modules/**',
            '**/dist/**',
            '**/release/**',
            '**/.package/**',
            'framework/tiny-sha256.js'
        ]
    },
    {
        files: ['tools/**/*.js', 'service/**/*.js'],
        ignores: ['tools/dev/remote.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: Object.assign({}, NODE_GLOBALS, { tizen: 'readonly', webapis: 'readonly' })
        },
        rules: CORRECTNESS_RULES
    },
    {
        files: ['framework/**/*.js', 'mods/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: BROWSER_GLOBALS
        },
        rules: CORRECTNESS_RULES
    },
    {
        files: ['tools/rollup.config.mjs'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: NODE_GLOBALS
        },
        rules: CORRECTNESS_RULES
    },
    {
        files: ['test/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            // A test that stands in for the page stubs what the page would have provided, so the
            // shipped code it exercises can be copied verbatim rather than adapted to run here.
            globals: Object.assign({}, NODE_GLOBALS, {
                window: 'readonly',
                document: 'readonly',
                location: 'writable',
                CustomEvent: 'readonly'
            })
        },
        rules: CORRECTNESS_RULES
    },
    {
        files: STYLED,
        ignores: UNSTYLED,
        rules: STYLE_RULES
    },

    {
        files: ['framework/**/*.js'],
        rules: {
            'no-restricted-imports': ['error', {
                patterns: [{
                    group: ['**/mods/**', '**/service/**', '**/tools/**'],
                    message: 'the framework may not know a feature exists — invert it with register()'
                }]
            }]
        }
    },
    {
        files: ['mods/**/*.js'],
        rules: {
            'no-restricted-imports': ['error', {
                patterns: [
                    {
                        group: ['**/framework/*', '!**/framework/index.js'],
                        message: 'import from framework/index.js — the rest of the framework is private'
                    },
                    {
                        group: ['**/service/**', '**/tools/**'],
                        message: 'a mod may not reach the service or the build tools'
                    }
                ]
            }]
        }
    },
    {
        files: ['mods/**/*.js'],
        ignores: UNSTYLED.concat(['mods/feed/surfaces.js']),
        rules: {
            'no-restricted-syntax': ['error'].concat(STYLE_SELECTORS, [NOT_THE_FEEDS_KEEPER])
        }
    },

    // Not shipped and not Node either: a classic script injected into the page by the dev service.
    // Held to the same engine floor as the userscript, because it runs in the same engine.
    {
        files: ['tools/dev/remote.js'],
        languageOptions: {
            ecmaVersion: 2018,
            sourceType: 'script',
            globals: BROWSER_GLOBALS
        },
        rules: CORRECTNESS_RULES
    }
];
