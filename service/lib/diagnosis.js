'use strict';

// Everything the container route needs, checked one by one. Run only when the boot screen says it
// is stuck: the happy path must stay fast.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const x509 = require('./x509.js');
const ports = require('./ports.js');
const reach = require('./reach.js');
const postmortem = require('./postmortem.js');
const claimants = require('./claimants.js');
const cobaltIfItLoads = require('./cobaltIfItLoads.js');
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

// Stock YouTube claims this slot too. Whoever launches the container decides its switches, and a
// container already up is one we may not close — so ours opens into theirs and never reaches us.
const named = (others) => others
    .map((one) => `${one.name} (${one.id})${one.baseUrl ? ` → ${one.baseUrl}` : ''}`)
    .join(', ');

const slot = () => {
    const others = claimants.rivals();

    // container() is null on a widget whose config.xml would not read, which the container check
    // already says; a rival always carries the slot it claims.
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

// The CA's key, the boot screen and Evergreen's record all live here. A partition that is full or
// read-only otherwise surfaces as whichever write throws first, half way through a start.
const writable = () => {
    const probe = path.join(SHARE, '.writable');

    try {
        fs.mkdirSync(SHARE, { recursive: true });
        fs.writeFileSync(probe, '');
        fs.unlinkSync(probe);

        return result('share', true, `${SHARE} can be written to`);
    } catch (error) {
        return result('share', false, `${SHARE} cannot be written to (${error.code || error.message}) — `
            + 'the certificate, the boot screen and Evergreen\'s files are all kept there');
    }
};

// Three files must agree on this port and only the packager compares them, so a set can still come
// up with TUBE_PROXY_PORT having moved one of them.
const proxyPort = () => {
    const named = /--proxy=http:\/\/[^:\s]+:(\d+)/.exec(switches() || '');
    if (!named) return result('proxy port', true, 'no --proxy switch names a port');

    const aimed = Number(named[1]);

    return result('proxy port', aimed === ports.PROXY, aimed === ports.PROXY
        ? `the container is aimed at ${aimed}, which is where we listen`
        : `the container is aimed at ${aimed} but we listen on ${ports.PROXY}, so nothing it asks for reaches us`);
};

// Worked out at startup and otherwise only written to the log.
const addressed = () => {
    const cobalt = cobaltIfItLoads();
    const found = cobalt && cobalt.addressing();

    if (!found) return result('proxy address', true, 'not checked yet');

    return result('proxy address', found.ok, found.why);
};

const day = (at) => new Date(at).toISOString().slice(0, 10);

// A certificate this set issued cannot have been signed in the future: read that way, the clock is
// wrong, and every TLS handshake fails with nothing on screen to say why. Left out rather than
// failed where the runtime cannot read a certificate at all.
const clock = () => {
    const material = existingMaterial();
    if (!material || !crypto.X509Certificate) return null;

    const cert = new crypto.X509Certificate(material.chain);
    const from = new Date(cert.validFrom).getTime();
    const to = new Date(cert.validTo).getTime();
    const now = Date.now();

    if (now < from) {
        return result('clock', false, `the TV reads ${day(now)}, before its own certificate was issued `
            + `(${day(from)}) — the clock is wrong, and no secure connection can succeed until it is set`);
    }

    if (now > to) {
        return result('clock', false, `the TV reads ${day(now)}, past the certificate's ${day(to)} — `
            + 'either the clock is wrong or the certificate was never reissued');
    }

    return result('clock', true, `${day(now)}, inside the certificate's window to ${day(to)}`);
};

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
        // Only where served() is reliable: the 5.0 widget has no boot screen and no CONNECT, so
        // silence there would mean nothing.
        content ? guarded('container slot', slot) : null,
        guarded('share', writable),
        guarded('proxy port', proxyPort),
        guarded('proxy address', addressed),
        guarded('certificate', certificate),
        guarded('clock', clock),
        guarded('youtube', network),
        guarded('evergreen', evergreen),
        content ? guarded('content', () => ours(content)) : null,
        content ? guarded('icu', () => icu(content)) : null,
        content ? guarded('trust store', () => trusted(content)) : null,
        content ? guarded('boot screen', () => bootPage(content)) : null
    ].filter(Boolean);
};

const worded = (found) => `${found.ok ? 'ok' : 'FAILED'}: ${found.name} — ${found.detail}`;

// Run without a trace, for a page that may be reloaded: writing to the journal on every read would
// push out the history the reader is being asked to report.
const checks = () => all();

// Noted as well as answered, so the boot screen shows them through the log it already streams and
// /__tube/log keeps them for whoever is asked to report it.
const diagnose = () => {
    const found = checks();
    const failed = found.filter((one) => !one.ok);

    postmortem.note('check', `${found.length} checks run, ${failed.length} failed`);
    found.forEach((one) => postmortem.note('check', worded(one)));

    return found;
};

module.exports = { checks, diagnose };
