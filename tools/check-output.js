'use strict';

// Refuses a bundle that reaches for a built-in newer than the runtime it will land on.
//
//   node tools/check-output.js <file> <node12|cobalt3|cobalt20|node4>

const { readFileSync } = require('fs');
const acorn = require('acorn');

const COBALT3_METHODS = {
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
    groupBy: 'Chrome 117'
};

const SINCE = {
    node12: {
        at: 'node 16.6',
        replaceAll: 'node 15',
        hasOwn: 'node 16.9',
        any: 'node 15',
        findLast: 'node 18',
        findLastIndex: 'node 18',
        groupBy: 'node 21',
        toSorted: 'node 20',
        toReversed: 'node 20',
        toSpliced: 'node 20'
    },
    cobalt3: COBALT3_METHODS,

    // Cobalt 20 runs V8 6.5, roughly Chrome 65, and the userscript ships to both widgets.
    cobalt20: Object.assign({}, COBALT3_METHODS, {
        trimStart: 'Chrome 66',
        trimEnd: 'Chrome 66'
    }),

    // core-js supplies every built-in node 4.4.3 lacks.
    node4: {}
};

// Cobalt's URL is partial: no searchParams and no URLSearchParams global.
const COBALT3_GLOBALS = {
    structuredClone: 'Chrome 98',
    queueMicrotask: 'Chrome 71',
    URLSearchParams: 'absent from Cobalt'
};

const GLOBALS_SINCE = {
    node12: { structuredClone: 'node 17' },
    cobalt3: COBALT3_GLOBALS,

    // Matched as a callee: constructing one throws on the set, while `input instanceof URL` passes.
    cobalt20: Object.assign({}, COBALT3_GLOBALS, {
        URL: 'not constructible in Cobalt 20 — read the host with a regex',
        Worker: 'absent from Cobalt 20'
    }),

    node4: {}
};

// A property Cobalt's own URL does not define, whatever Chrome does.
const PROPERTIES_ABSENT = {
    node12: {},
    cobalt3: { searchParams: "absent from Cobalt's URL" },
    cobalt20: { searchParams: "absent from Cobalt's URL" },
    node4: {}
};

// Node 12 parses exactly ES2019, while a browser engine maps onto no ECMAScript year, so its parse
// only proves the file is valid JavaScript.
const FLOORS = {
    node12: { label: 'node 12', ecmaVersion: 2019 },
    cobalt3: { label: 'Cobalt 3.2.1', ecmaVersion: 2022 },
    // What terser is told to emit, the real syntax ceiling for the shipped bundle.
    cobalt20: { label: 'Cobalt 20 (V8 6.5)', ecmaVersion: 2017 },
    // ES5, which node 4.4.3 reads safely.
    node4: { label: 'node 4.4.3', ecmaVersion: 5 }
};

const file = process.argv[2];
const which = process.argv[3];
const floor = FLOORS[which];

if (!file || !floor) {
    console.error('usage: check-output.js <file> <node12|cobalt3|cobalt20|node4>');
    process.exit(2);
}

function parseOrExit(source) {
    try {
        return acorn.parse(source, { ecmaVersion: floor.ecmaVersion, sourceType: 'script' });
    } catch (error) {
        console.error(`      ${file} does not parse as ${floor.label} would read it: ${error.message}`);
        return process.exit(1);
    }
}

const parsed = parseOrExit(readFileSync(file, 'utf8'));

// Matched only where the name is called, since `{ at: Date.now() }` and
// `Object.prototype.hasOwnProperty` are ordinary property names.
const methods = SINCE[which];
const globals = GLOBALS_SINCE[which];
const properties = PROPERTIES_ABSENT[which];

const lookup = (name, table) => (Object.prototype.hasOwnProperty.call(table, name)
    ? [{ name, since: table[name] }]
    : []);

const called = (callee) => {
    if (callee.type === 'Identifier') return lookup(callee.name, globals);

    if (callee.type === 'MemberExpression' && !callee.computed
        && callee.property && callee.property.type === 'Identifier') {
        return lookup(callee.property.name, methods);
    }

    return [];
};

const visit = (node) => {
    if (!node || typeof node !== 'object') return [];

    if (Array.isArray(node)) return node.flatMap(visit);

    // NewExpression too, since `new URLSearchParams()` is not a call.
    const calls = (node.type === 'CallExpression' || node.type === 'NewExpression') && node.callee
        ? called(node.callee)
        : [];

    // `url.searchParams` is undefined on Cobalt's partial URL, so reading it is enough to break.
    const reads = node.type === 'MemberExpression' && !node.computed
        && node.property && node.property.type === 'Identifier'
        ? lookup(node.property.name, properties)
        : [];

    return calls.concat(reads, Object.keys(node).flatMap((key) => (key === 'type' ? [] : visit(node[key]))));
};

const hits = visit(parsed);
const reached = hits.filter((hit, index) => hits.findIndex((other) => other.name === hit.name) === index);

if (reached.length) {
    console.error(`      ${file} reaches for built-ins ${floor.label} does not have:`);
    reached.forEach((found) => console.error(`        ${found.name}  ${found.since}`));
    console.error('      Nothing polyfills these — use something the floor already has.');
    process.exit(1);
}

console.log(`      runs on ${floor.label}`);
