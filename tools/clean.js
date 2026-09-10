'use strict';

const { execFileSync } = require('child_process');
const { rmSync, existsSync, statSync } = require('fs');
const { join } = require('path');

const ui = require('./report.js');
const { ROOT } = require('./config.js');

const ARTEFACTS = require('./paths.js').ARTEFACTS;

const DEEP = ['node_modules'];

// `du` reports what the tree occupies; statSync only ever describes the directory entry itself,
// so it is the fallback rather than the answer.
function sizeOf(path) {
    try {
        return execFileSync('du', ['-sk', path], { encoding: 'utf8' }).split('\t')[0].trim() * 1024;
    } catch (e) {
        return statSync(path).size;
    }
}

const all = process.argv.indexOf('--all') !== -1;
const targets = all ? ARTEFACTS.concat(DEEP) : ARTEFACTS;

ui.heading('clean');

const remove = (relative) => {
    const path = join(ROOT, relative);
    const size = sizeOf(path);
    rmSync(path, { recursive: true, force: true });
    ui.ok(relative);
    return size;
};

const sizes = targets
    .filter((relative) => existsSync(join(ROOT, relative)))
    .map(remove);

const freed = sizes.reduce((total, size) => total + size, 0);

ui.blank();
if (!sizes.length) {
    ui.note('Nothing to clean.');
} else {
    ui.note(`Removed ${sizes.length} path${sizes.length === 1 ? '' : 's'}, freeing ${ui.bytes(freed)}.`);
    if (all) ui.note(ui.style.dim('Run `npm install` before building again.'));
}
ui.blank();
