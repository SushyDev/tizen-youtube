'use strict';

// Verifies the built bundle only uses syntax Tizen 3's Node v4.4.3 can parse. Node 4 is
// not ES5 — it has arrow functions, classes, template literals and let/const — but it
// lacks destructuring, default and rest parameters, spread, async/await and `**`.
// Grepping cannot tell those from string contents, so this walks the AST.

const acorn = require('acorn');
const { readFileSync } = require('fs');

const UNSUPPORTED = {
    AwaitExpression: 'await',
    ObjectPattern: 'destructuring',
    ArrayPattern: 'destructuring',
    AssignmentPattern: 'default parameter',
    RestElement: 'rest parameter',
    SpreadElement: 'spread'
};

function check(file) {
    const source = readFileSync(file, 'utf8');
    let ast;
    try {
        ast = acorn.parse(source, { ecmaVersion: 2022, sourceType: 'script', locations: true });
    } catch (e) {
        console.error(`${file}: could not be parsed at all — ${e.message}`);
        return 1;
    }

    const findings = [];

    (function walk(node) {
        if (!node || typeof node.type !== 'string') return;

        const label = UNSUPPORTED[node.type];
        if (label) findings.push({ label, line: node.loc.start.line });

        if (node.async === true) findings.push({ label: 'async function', line: node.loc.start.line });
        if (node.type === 'BinaryExpression' && node.operator === '**') {
            findings.push({ label: 'exponent operator', line: node.loc.start.line });
        }

        for (const key in node) {
            if (key === 'loc' || key === 'type') continue;
            const value = node[key];
            if (Array.isArray(value)) value.forEach(walk);
            else if (value && typeof value.type === 'string') walk(value);
        }
    })(ast);

    if (!findings.length) {
        console.log(`${file}: clean — parses on Node 4.4.3 (Tizen 3).`);
        return 0;
    }

    const byLabel = {};
    findings.forEach((f) => {
        if (!byLabel[f.label]) byLabel[f.label] = [];
        byLabel[f.label].push(f.line);
    });

    console.error(`${file}: ${findings.length} construct(s) Node 4.4.3 cannot parse:`);
    for (const label in byLabel) {
        const lines = byLabel[label];
        console.error(`  ${label} x${lines.length}  (first at line ${lines[0]})`);
    }
    return 1;
}

process.exit(check(process.argv[2] || 'dist/index.js'));
