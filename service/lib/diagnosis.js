'use strict';

// Run only when the boot screen says it is stuck, because the happy path must stay fast.

const fs = require('fs');
const path = require('path');

const reach = require('./reach.js');
const postmortem = require('./postmortem.js');
const claimants = require('./claimants.js');
const cobaltIfItLoads = require('./cobaltIfItLoads.js');
const { appId, configuredContent, container, switches } = require('./cobaltConfig.js');
const { STOCK, locate } = require('./cobaltContent.js');

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

const named = (others) => others
    .map((one) => `${one.name} (${one.id})${one.baseUrl ? ` → ${one.baseUrl}` : ''}`)
    .join(', ');

const slot = () => {
    const others = claimants.rivals();

    // container() is null on a widget whose config.xml would not read.
    const ours = container() || 'the container slot';

    if (others === null) return result('container slot', true, 'the installed apps have not been surveyed yet');
    if (!others.length) return result('container slot', true, `no other app claims ${ours}`);

    const contested = others[0].slot || ours;
    const cobalt = cobaltIfItLoads();
    const heard = !!(cobalt && cobalt.contact().at);

    if (heard) return result('container slot', true, `${named(others)} claims ${contested} too, but ours is the one running`);

    return result('container slot', false, `${named(others)} claims ${contested} too, and nothing from `
        + 'ours has reached us — that app\'s container is running with its own switches, and this app '
        + 'cannot close a container it did not start. Close YouTube on the TV, then switch the TV off '
        + 'at the plug for 30 seconds (standby is not enough) and open this app first.');
};

// A full or read-only partition otherwise surfaces as whichever write throws first, half way
// through a start.
const writable = () => {
    const probe = path.join(SHARE, '.writable');

    try {
        fs.mkdirSync(SHARE, { recursive: true });
        fs.writeFileSync(probe, '');
        fs.unlinkSync(probe);

        return result('share', true, `${SHARE} can be written to`);
    } catch (error) {
        return result('share', false, `${SHARE} cannot be written to (${error.code || error.message}) — `
            + 'the boot screen and Evergreen\'s files are both kept there');
    }
};

const ours = (content) => {
    const entries = listing(content);

    return result('content', entries.length > 0, entries.length
        ? `${content} holds ${some(entries)}`
        : `${content} is empty or unreadable, so Cobalt has nothing to run`);
};

// Cobalt exits before any page when its ICU data does not match the library.
const icu = (content) => {
    const entries = listing(path.join(content, 'icu'));

    return result('icu', entries.length > 0, entries.length
        ? `icu holds ${some(entries)}`
        : 'icu is empty, and Cobalt exits before any page without it');
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

// A check that cannot run must not stop the rest.
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
        // The 5.0 widget has no boot screen and no CONNECT, so silence there would mean nothing.
        content ? guarded('container slot', slot) : null,
        guarded('share', writable),
        guarded('youtube', network),
        guarded('evergreen', evergreen),
        content ? guarded('content', () => ours(content)) : null,
        content ? guarded('icu', () => icu(content)) : null,
        content ? guarded('boot screen', () => bootPage(content)) : null
    ].filter(Boolean);
};

const worded = (found) => `${found.ok ? 'ok' : 'FAILED'}: ${found.name} — ${found.detail}`;

// Writing to the journal on every read would push out the history the reader is being asked to
// report.
const checks = () => all();

const diagnose = () => {
    const found = checks();
    const failed = found.filter((one) => !one.ok);

    postmortem.note('check', `${found.length} checks run, ${failed.length} failed`);
    found.forEach((one) => postmortem.note('check', worded(one)));

    return found;
};

module.exports = { checks, diagnose };
