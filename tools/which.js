'use strict';

// Locates an executable, checking the repository's own node_modules/.bin
// before PATH.
//
// tizenjs ships as a dependency (the `tizen` package), so packaging needs no
// global install. Anything run through `npm run` already has that directory on
// PATH, but the tools are also runnable directly with node, where it is not.

const { accessSync, constants } = require('fs');
const { join, delimiter } = require('path');

const ROOT = join(__dirname, '..');

function isExecutable(path) {
    try {
        accessSync(path, constants.X_OK);
        return true;
    } catch (e) {
        return false;
    }
}

function which(binary) {
    const local = join(ROOT, 'node_modules', '.bin', binary);
    if (isExecutable(local)) return local;

    for (const dir of (process.env.PATH || '').split(delimiter).filter(Boolean)) {
        const candidate = join(dir, binary);
        if (isExecutable(candidate)) return candidate;
    }
    return null;
}

module.exports = { which };
