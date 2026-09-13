'use strict';

// mkdirSync's recursive option arrived in node 10.12; before it the option is ignored.

const fs = require('fs');
const path = require('path');

const native = fs.mkdirSync;

const understood = () => {
    const [major, minor] = process.versions.node.split('.').map(Number);
    return major > 10 || (major === 10 && minor >= 12);
};

const isDirectory = (dir) => {
    try {
        return fs.statSync(dir).isDirectory();
    } catch (e) {
        return false;
    }
};

const makeAll = (dir, mode) => {
    if (isDirectory(dir)) return undefined;

    const parent = path.dirname(dir);
    if (parent !== dir) makeAll(parent, mode);

    try {
        native.call(fs, dir, mode);
    } catch (error) {
        if (!isDirectory(dir)) throw error;
    }

    return undefined;
};

const mkdirSync = (dir, options) => (options && typeof options === 'object' && options.recursive
    ? makeAll(path.resolve(String(dir)), options.mode)
    : native.call(fs, dir, options));

if (!understood()) fs.mkdirSync = mkdirSync;

module.exports = { mkdirSync };
