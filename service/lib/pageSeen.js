'use strict';

// Whether YouTube's page came through us, and whether the userscript ran in it: the two things a
// report of "no mods" turns on, and neither is visible on the TV.

const held = { servedAt: 0, bootedAt: 0, patched: false };

const served = () => {
    held.servedAt = Date.now();
};

// The page's boot beacon, as the journal hears it.
const heard = (line) => {
    if (String(line).indexOf('booted ') !== 0) return;

    held.bootedAt = Date.now();
    held.patched = line.indexOf('fetch patched') !== -1;
};

const seen = () => Object.assign({}, held);

module.exports = { served, heard, seen };
