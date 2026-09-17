'use strict';

// Stages Cobalt's own content as links, because --content replaces the directory wholesale.

const fs = require('fs');
const path = require('path');

const postmortem = require('./postmortem.js');

const PACKAGE = '/usr/apps/com.samsung.tv.cobalt';
const STOCK = `${PACKAGE}/content/app/cobalt/content`;

const DEEPEST = 6;
const MOST_FOUND = 12;

const note = (what, detail) => postmortem.note('cobalt', `${what}: ${postmortem.describe(detail)}`);

const isLink = (file) => {
    try {
        return fs.lstatSync(file).isSymbolicLink();
    } catch (e) {
        return false;
    }
};

// Folders stay real, so our certificate, the boot screen and Evergreen's files can be written
// beside the links.
const linkInto = (from, to) => {
    if (isLink(to)) fs.unlinkSync(to);
    fs.mkdirSync(to, { recursive: true });

    return fs.readdirSync(from).reduce((linked, entry) => {
        const source = path.join(from, entry);
        const target = path.join(to, entry);

        if (fs.statSync(source).isDirectory()) return linked + linkInto(source, target);
        if (isLink(target)) return linked;

        // Renamed into place, so a Cobalt starting meanwhile never finds the file missing.
        const staged = `${target}.${process.pid}`;
        fs.symlinkSync(source, staged);
        fs.renameSync(staged, target);
        return linked + 1;
    }, 0);
};

const isDirectory = (dir) => {
    try { return fs.statSync(dir).isDirectory(); } catch (e) { return false; }
};

const cobaltIsInstalledHere = () => isDirectory(STOCK);

const listing = (dir) => {
    try { return fs.readdirSync(dir); } catch (e) { return []; }
};

// Content directories are the ones holding ssl/certs.
const findContent = (dir, depth) => (depth > DEEPEST ? [] : listing(dir).reduce((found, entry) => {
    const full = path.join(dir, entry);

    if (found.length >= MOST_FOUND || !isDirectory(full)) return found;
    if (entry === 'certs' && path.basename(dir) === 'ssl') return found.concat(path.dirname(dir));

    return found.concat(findContent(full, depth + 1));
}, []));

const locate = () => {
    if (isDirectory(STOCK)) return STOCK;

    const found = findContent(PACKAGE, 0);
    return found.find((dir) => isDirectory(path.join(dir, 'icu'))) || found[0] || null;
};

const discover = () => {
    if (!isDirectory(PACKAGE)) return `nothing at ${PACKAGE} either`;

    const found = findContent(PACKAGE, 0);

    return `${PACKAGE} holds [${listing(PACKAGE).join(', ')}]; content directories: `
        + `${found.length ? found.join(', ') : 'none readable'}`;
};

// Answered rather than thrown, so a staging failure goes the same way as everything else in
// prepare().
const stageOrFail = (content, from = STOCK) => {
    try {
        const linked = linkInto(from, content);
        if (linked) note('staged', `${linked} files linked into ${content}`);

        return {};
    } catch (error) {
        return { error };
    }
};

module.exports = { STOCK, cobaltIsInstalledHere, discover, findContent, locate, stageOrFail };
