'use strict';

// Refuses a bundle that reaches for a built-in newer than the runtime it will land on.
//
// Babel and esbuild lower *syntax* to their target and do it well, but neither polyfills a library
// call: `[].flatMap(...)` compiles to itself and throws on an engine that has never heard of it.
// A parser cannot see that, because it is a method name and not a keyword — which is how
// `Object.values` came to ship into a Chromium 47 bundle unnoticed.
//
//   node tools/check-output.js <file> <node12|cobalt3>
//
// Two device pairs are verified on real hardware; everything between them is not:
//
//   Tizen 6.5   node 12.16.3   Cobalt 3.2.1   <- the floor
//   Tizen 9.0   node 18.18.2   Cobalt 5.2.1
//
// The service runs on the set's Node. The userscript runs inside *Cobalt*, not the set's webview,
// so its floor is Cobalt's engine. Cobalt 3.2.1's V8 is very likely newer than Chrome 63, but
// Chrome 63 is the target that has actually run on it, and a guess costs a black screen on a set
// we cannot reach. tools/engine-probe.js measures the real ceiling; raise this once it has.

const { readFileSync } = require('fs');
const acorn = require('acorn');

// Only what is newer than the floor needs listing — anything older is on every runtime we ship to.
const SINCE = {
    node12: {
        at: 'node 16.6',
        replaceAll: 'node 15',
        hasOwn: 'node 16.9',
        any: 'node 15',
        findLast: 'node 18',
        findLastIndex: 'node 18',
        group: 'node 21',
        groupBy: 'node 21',
        toSorted: 'node 20',
        toReversed: 'node 20',
        toSpliced: 'node 20'
    },
    cobalt3: {
        flat: 'Chrome 69',
        flatMap: 'Chrome 69',
        fromEntries: 'Chrome 73',
        matchAll: 'Chrome 73',
        allSettled: 'Chrome 76',
        replaceAll: 'Chrome 85',
        any: 'Chrome 85',
        at: 'Chrome 92',
        hasOwn: 'Chrome 93',
        findLast: 'Chrome 97',
        findLastIndex: 'Chrome 97',
        toSorted: 'Chrome 110',
        toReversed: 'Chrome 110',
        toSpliced: 'Chrome 110',
        group: 'Chrome 117',
        groupBy: 'Chrome 117'
    }
};

const GLOBALS_SINCE = {
    node12: { structuredClone: 'node 17' },
    cobalt3: { structuredClone: 'Chrome 98', globalThis: 'Chrome 71', queueMicrotask: 'Chrome 71' }
};

// Node maps onto an ECMAScript year, so its syntax is checked exactly: node 12 is ES2019, and an
// unlowered `?.` fails the parse. An engine version does not map onto a year, so on the browser
// side the parse only proves the file is valid JavaScript and Babel's target holds the syntax.
const FLOORS = {
    node12: { label: 'node 12', ecmaVersion: 2019 },
    cobalt3: { label: 'Cobalt 3.2.1', ecmaVersion: 2022 }
};

const file = process.argv[2];
const which = process.argv[3];
const floor = FLOORS[which];

if (!file || !floor) {
    console.error('usage: check-output.js <file> <node12|cobalt3>');
    process.exit(2);
}

// The boot screen is inlined into one HTML file, so the script has to come back out of it first.
const sourceOf = (contents) => {
    if (!/\.html?$/.test(file)) return contents;

    const scripts = contents.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
    return scripts.map((tag) => tag.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')).join('\n;\n');
};

const parsed = (() => {
    try {
        return acorn.parse(sourceOf(readFileSync(file, 'utf8')),
            { ecmaVersion: floor.ecmaVersion, sourceType: 'script' });
    } catch (error) {
        console.error(`      ${file} does not parse as ${floor.label} would read it: ${error.message}`);
        return process.exit(1);
    }
})();

// Matched on the AST, and only where the name is actually *called*. Every entry above is a method
// or a function, and these are ordinary property names too: `{ at: Date.now() }` and
// `Object.prototype.hasOwnProperty` are not what this is looking for.
const methods = SINCE[which];
const globals = GLOBALS_SINCE[which];
const reached = [];

const note = (name, table) => {
    if (!Object.prototype.hasOwnProperty.call(table, name)) return;
    if (reached.some((found) => found.name === name)) return;

    reached.push({ name, since: table[name] });
};

const visit = (node) => {
    if (!node || typeof node !== 'object') return;

    if (Array.isArray(node)) return node.forEach(visit);

    if (node.type === 'CallExpression' && node.callee) {
        const callee = node.callee;

        if (callee.type === 'Identifier') note(callee.name, globals);

        if (callee.type === 'MemberExpression' && !callee.computed
            && callee.property && callee.property.type === 'Identifier') {
            note(callee.property.name, methods);
        }
    }

    return Object.keys(node).forEach((key) => { if (key !== 'type') visit(node[key]); });
};

visit(parsed);

if (reached.length) {
    console.error(`      ${file} reaches for built-ins newer than ${floor.label}:`);
    reached.forEach((found) => console.error(`        ${found.name}()  arrived in ${found.since}`));
    console.error('      Nothing polyfills these — use something the floor already has.');
    process.exit(1);
}

console.log(`      runs on ${floor.label}`);
