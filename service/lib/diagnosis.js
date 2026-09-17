'use strict';

// Everything the container route needs, checked one by one. Run only when the boot screen says it
// is stuck: the happy path must stay fast.

const fs = require('fs');
const path = require('path');

const x509 = require('./x509.js');
const reach = require('./reach.js');
const postmortem = require('./postmortem.js');
const { appId, configuredContent, container, switches } = require('./cobaltConfig.js');
const { STOCK, locate } = require('./cobaltContent.js');
const { existingMaterial, stillGood } = require('./cobaltCa.js');

const SHARE = process.env.TUBE_SHARE || '/home/owner/share/tube';
const SHOWN = 8;

const result = (name, ok, detail) => ({ name, ok, detail });

const listing = (dir) => {
    try { return fs.readdirSync(dir); } catch (e) { return []; }
};

const ageOf = (file) => {
    try { return Date.now() - fs.statSync(file).mtime.getTime(); } catch (e) { return null; }
};

const some = (entries) => (entries.length > SHOWN
    ? `${entries.slice(0, SHOWN).join(', ')} and ${entries.length - SHOWN} more`
    : entries.join(', '));

const builtIn = () => {
    const from = locate();

    return result('cobalt', !!from, from ? `its own content is at ${from}` : `nothing found under ${STOCK}`);
};

const claim = () => result('container', !!container(), container()
    ? `${appId()} runs ${container()} with ${switches()}`
    : 'this widget claims no container slot, so nothing of ours can run');

const ours = (content) => {
    const entries = listing(content);

    return result('content', entries.length > 0, entries.length
        ? `${content} holds ${some(entries)}`
        : `${content} is empty or unreadable, so Cobalt has nothing to run`);
};

// Cobalt exits before any page when its ICU data does not match the library, which is what an
// Evergreen update against an older copy looks like.
const icu = (content) => {
    const entries = listing(path.join(content, 'icu'));

    return result('icu', entries.length > 0, entries.length
        ? `icu holds ${some(entries)}`
        : 'icu is empty, and Cobalt exits before any page without it');
};

const certificate = () => {
    const material = existingMaterial();
    if (!material) return result('certificate', false, 'none has been made yet');

    const good = stillGood(material);

    return result('certificate', good, good
        ? `${material.ca.commonName} is current`
        : `${material.ca.commonName} is expired or made for other names, and is reissued on the next start`);
};

// The store is hashed, so ours is trusted only under the exact name OpenSSL looks it up by.
const trusted = (content) => {
    const material = existingMaterial();
    if (!material) return null;

    const certs = path.join(content, 'ssl', 'certs');
    const all = listing(certs);
    const hashes = x509.subjectHashes(material.ca.commonName);
    const wanted = [hashes.hash, hashes.hashOld];
    const found = all.filter((name) => wanted.indexOf(name.split('.')[0]) !== -1);

    return result('trust store', found.length > 0, found.length
        ? `${found.join(', ')} among ${all.length} certificates`
        : `none of ${wanted.join(', ')} is among the ${all.length} certificates in ${certs}`);
};

const bootPage = (content) => {
    const file = path.join(content, 'web', 'tube', 'boot.html');
    const age = ageOf(file);

    return result('boot screen', age !== null, age === null ? `${file} is missing` : `written ${Math.round(age / 1000)}s ago`);
};

const evergreen = () => {
    try {
        const names = JSON.parse(fs.readFileSync(path.join(SHARE, 'evergreen.json'), 'utf8')).merged || [];

        return result('evergreen', true, names.length ? `merged ${some(names)}` : 'nothing merged yet');
    } catch (e) {
        return result('evergreen', true, 'no update has been merged yet');
    }
};

const network = () => {
    const found = reach.current();

    return result('youtube', found.ok !== false, `${found.host}: ${found.why}`);
};

// Answered rather than thrown: a check that cannot run must not stop the rest.
const guarded = (name, run) => {
    try {
        return run();
    } catch (error) {
        return result(name, false, `could not be checked: ${postmortem.describe(error)}`);
    }
};

const all = () => {
    const content = configuredContent();

    return [
        guarded('cobalt', builtIn),
        guarded('container', claim),
        guarded('certificate', certificate),
        guarded('youtube', network),
        guarded('evergreen', evergreen),
        content ? guarded('content', () => ours(content)) : null,
        content ? guarded('icu', () => icu(content)) : null,
        content ? guarded('trust store', () => trusted(content)) : null,
        content ? guarded('boot screen', () => bootPage(content)) : null
    ].filter(Boolean);
};

const worded = (found) => `${found.ok ? 'ok' : 'FAILED'}: ${found.name} — ${found.detail}`;

// Noted rather than answered, so the screen shows it through the log it already streams and
// /__tube/log keeps it for whoever is asked to report it.
const diagnose = () => {
    const found = all();
    const failed = found.filter((one) => !one.ok);

    postmortem.note('check', `${found.length} checks run, ${failed.length} failed`);
    found.forEach((one) => postmortem.note('check', worded(one)));

    return found;
};

module.exports = { diagnose };
