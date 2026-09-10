'use strict';

// Staging the container's Evergreen content directory.
//
// --content replaces that directory wholesale, so ours has to hold everything Cobalt's own does —
// fonts, icu, licenses, certs — before the container will start against it. About 5.1MB, nearly
// all of it icu/icudt68l.dat, copied once and then never again.

const fs = require('fs');
const path = require('path');

const postmortem = require('./postmortem.js');
const { existingMaterial } = require('./cobaltCa.js');

const STOCK = '/usr/apps/com.samsung.tv.cobalt/content/app/cobalt/content';

const note = (what, detail) => postmortem.note('cobalt', `${what}: ${postmortem.describe(detail)}`);

// Same size is enough to call a file done: a firmware update replaces the whole directory.
const copyInto = (from, to) => {
    fs.mkdirSync(to, { recursive: true });

    return fs.readdirSync(from).reduce((copied, entry) => {
        const source = path.join(from, entry);
        const target = path.join(to, entry);
        const info = fs.statSync(source);

        if (info.isDirectory()) return copied + copyInto(source, target);

        try {
            if (fs.statSync(target).size === info.size) return copied;
        } catch (e) { /* absent, so copy it */ }

        fs.writeFileSync(target, fs.readFileSync(source));
        return copied + 1;
    }, 0);
};

const cobaltIsInstalledHere = () => {
    try { return fs.statSync(STOCK).isDirectory(); } catch (e) { return false; }
};

const stagedMaterial = (content) => {
    const copied = copyInto(STOCK, content);
    if (copied) note('staged', `${copied} files into ${content}`);

    return existingMaterial();
};

// Answered rather than thrown, so a staging failure is reported through the same path everything
// else in prepare() is.
const stageOrFail = (content) => {
    try {
        return { material: stagedMaterial(content) };
    } catch (error) {
        return { error };
    }
};

module.exports = { STOCK, cobaltIsInstalledHere, stageOrFail };
