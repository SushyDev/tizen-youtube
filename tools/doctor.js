'use strict';

const { existsSync } = require('fs');
const { join } = require('path');

const ui = require('./lib/report.js');
const { load, CONFIG_PATH, ROOT } = require('./lib/config.js');

const checks = [];

function check(name, fn) {
    try {
        const result = fn();
        checks.push({ name, state: 'ok', detail: result && result.detail });
    } catch (e) {
        checks.push({ name, state: 'fail', detail: e.message });
    }
}

check('Node.js >= 20', () => {
    const major = Number(process.versions.node.split('.')[0]);
    if (major < 20) {
        throw new Error(`Found Node ${process.versions.node}. Install Node 20 or newer (see .nvmrc).`);
    }
    return { detail: `v${process.versions.node}` };
});

check('dependencies installed', () => {
    if (!existsSync(join(ROOT, 'node_modules'))) {
        throw new Error('No node_modules. Run: npm install');
    }
    const probes = ['rollup', '@babel/core', 'vite', 'eslint', 'typescript'];
    const missing = probes.filter((name) => !existsSync(join(ROOT, 'node_modules', name)));
    if (missing.length) {
        throw new Error(`Missing ${missing.join(', ')}. Run: npm install`);
    }
    return { detail: `${probes.length} key packages present` };
});

check('tizen.config.json', () => ({ detail: `version ${load().version}` }));

ui.heading('doctor', CONFIG_PATH.replace(`${ROOT}/`, ''));
ui.blank();

checks.forEach((entry) => {
    if (entry.state === 'ok') ui.ok(entry.name, entry.detail);
    else ui.fail(entry.name, entry.detail);
});

const failed = checks.filter((c) => c.state === 'fail');
ui.blank();

if (failed.length) {
    ui.note(`${failed.length} problem${failed.length === 1 ? '' : 's'} to fix before building.`);
    process.exit(1);
}

ui.note('Ready to build.  npm run build');
ui.blank();
