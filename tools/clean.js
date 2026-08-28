'use strict';

// Removes every build artefact. Sources and node_modules are left alone;
// `npm run clean -- --all` also drops node_modules.

const { rmSync, existsSync, statSync } = require('fs');
const { join } = require('path');

const ui = require('./ui.js');
const { ROOT } = require('./config.js');

const ARTEFACTS = [
    // Where rollup leaves the two userscript bundles, for the service to embed.
    'dist',
    'ui/dist',
    'service/dist',
    'service/.ncc',
    'release'
];

const DEEP = ['node_modules'];

function sizeOf(path) {
    try {
        const { execFileSync } = require('child_process');
        return execFileSync('du', ['-sk', path], { encoding: 'utf8' }).split('\t')[0].trim() * 1024;
    } catch (e) {
        return statSync(path).size;
    }
}

const all = process.argv.indexOf('--all') !== -1;
const targets = all ? ARTEFACTS.concat(DEEP) : ARTEFACTS;

ui.heading('clean');

let removed = 0;
let freed = 0;

targets.forEach((relative) => {
    const path = join(ROOT, relative);
    if (!existsSync(path)) return;
    freed += sizeOf(path);
    rmSync(path, { recursive: true, force: true });
    ui.ok(relative);
    removed++;
});

ui.blank();
if (!removed) {
    ui.note('Nothing to clean.');
} else {
    ui.note(`Removed ${removed} path${removed === 1 ? '' : 's'}, freeing ${ui.bytes(freed)}.`);
    if (all) ui.note(ui.style.dim('Run `npm install` before building again.'));
}
ui.blank();
