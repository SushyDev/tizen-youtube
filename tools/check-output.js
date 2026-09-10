'use strict';

// Refuses a bundle that reaches for a built-in newer than the runtime it will land on.
//
//   node tools/check-output.js <file> <node12|cobalt3>

const { readFileSync } = require('fs');
const acorn = require('acorn');

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
        groupBy: 'Chrome 117'
    }
};

const GLOBALS_SINCE = {
    node12: { structuredClone: 'node 17' },
    // URLSearchParams is Chrome 49 and so is not "newer than the floor" by version — but Cobalt's
    // URL is a partial implementation that carries `search` and stops there, with no searchParams
    // on it and no URLSearchParams global. Measured on the set after reaching for it silently
    // stopped SponsorBlock starting on any video. Version tables do not describe a partial engine.
    cobalt3: {
        structuredClone: 'Chrome 98',
        queueMicrotask: 'Chrome 71',
        URLSearchParams: 'absent from Cobalt'
    }
};

// Same reason: a property Cobalt's own URL does not define, whatever Chrome does.
const PROPERTIES_ABSENT = {
    node12: {},
    cobalt3: { searchParams: "absent from Cobalt's URL" }
};

// Node 12 parses exactly ES2019, while a browser engine maps onto no ECMAScript year, so its parse
// only proves the file is valid JavaScript.
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

// A parse failure is the whole answer: the file cannot run on the floor at all, so there is
// nothing further to check.
function parseOrExit(source) {
    try {
        return acorn.parse(source, { ecmaVersion: floor.ecmaVersion, sourceType: 'script' });
    } catch (error) {
        console.error(`      ${file} does not parse as ${floor.label} would read it: ${error.message}`);
        return process.exit(1);
    }
}

const parsed = parseOrExit(readFileSync(file, 'utf8'));

// Matched on the AST, and only where the name is actually *called*. Every entry above is a method
// or a function, and these are ordinary property names too: `{ at: Date.now() }` and
// `Object.prototype.hasOwnProperty` are not what this is looking for.
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

    // `new URLSearchParams()` is a NewExpression, not a call — checking only calls is how it
    // shipped into Cobalt, which has no such global.
    const calls = (node.type === 'CallExpression' || node.type === 'NewExpression') && node.callee
        ? called(node.callee)
        : [];

    // A property that is merely *read* rather than called. `url.searchParams` is undefined on
    // Cobalt's partial URL, and reading it is enough to break — no call is ever reached.
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
