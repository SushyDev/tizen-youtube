'use strict';

const fs = require('fs');
const path = require('path');

const NEEDLE = Buffer.from('{"alignment_char"');
const CLOSE = 0x7d;

// The SABI JSON the library embeds, exactly as its updater sends it.
const sabiIn = (bytes) => {
    const at = bytes.indexOf(NEEDLE);
    const end = at === -1 ? -1 : bytes.indexOf(CLOSE, at);

    return end === -1 ? null : bytes.toString('latin1', at, end + 1);
};

// Only an uncompressed library can be searched; an .lz4 one answers null.
const sabiOf = (stock) => {
    try {
        return sabiIn(fs.readFileSync(path.join(stock, '..', 'lib', 'libcobalt.so')));
    } catch (e) {
        return null;
    }
};

const versionOf = (stock) => {
    try {
        return JSON.parse(fs.readFileSync(path.join(stock, '..', 'manifest.json'), 'utf8')).version || null;
    } catch (e) {
        return null;
    }
};

module.exports = { sabiIn, sabiOf, versionOf };
