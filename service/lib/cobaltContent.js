'use strict';

// Stages a copy of Cobalt's own content, because --content replaces the directory wholesale.

const fs = require('fs');
const path = require('path');

const postmortem = require('./postmortem.js');

const PACKAGE = '/usr/apps/com.samsung.tv.cobalt';
const STOCK = `${PACKAGE}/content/app/cobalt/content`;

const DEEPEST = 6;
const MOST_FOUND = 12;

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

// Evergreen's layout, else a content directory found under the package, preferring one with ICU.
const locate = () => {
    if (isDirectory(STOCK)) return STOCK;

    const found = findContent(PACKAGE, 0);
    return found.find((dir) => isDirectory(path.join(dir, 'icu'))) || found[0] || null;
};

// For a set whose Cobalt is laid out otherwise, so its log says where the content is.
const discover = () => {
    if (!isDirectory(PACKAGE)) return `nothing at ${PACKAGE} either`;

    const found = findContent(PACKAGE, 0);

    return `${PACKAGE} holds [${listing(PACKAGE).join(', ')}]; content directories: `
        + `${found.length ? found.join(', ') : 'none readable'}`;
};

// Answered rather than thrown, so a staging failure is reported through the same path everything
// else in prepare() is.
const stageOrFail = (content, from = STOCK) => {
    try {
        const copied = copyInto(from, content);
        if (copied) note('staged', `${copied} files into ${content}`);

        return {};
    } catch (error) {
        return { error };
    }
};

module.exports = { STOCK, cobaltIsInstalledHere, discover, findContent, locate, stageOrFail };
