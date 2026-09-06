'use strict';

// Everything the container route needs that cannot be built into a package, made on the set.
//
// Two things were device-specific and had no business being so: the writable copy of Cobalt's
// content directory, and the certificate authority whose CA sits in it. Both are derived here on
// first run, which is what lets one widget serve any television. The address in --proxy is the
// only value left that a build cannot know, and it has to be filled in when the widget is
// installed — see docs/README.md.

const fs = require('fs');
const os = require('os');
const path = require('path');

const x509 = require('./x509.js');
const postmortem = require('./postmortem.js');

// The container's own content, and the only part of it worth having: it is readable by the app
// user, so a copy can be made without any privilege at all.
const STOCK = '/usr/apps/com.samsung.tv.cobalt/content/app/cobalt/content';

const SHARE = process.env.TUBE_SHARE || '/home/owner/share/tube';
const MITM_DIR = process.env.TUBE_MITM_DIR || path.join(SHARE, 'mitm');

// The hosts the page and its API actually reach. googlevideo is deliberately absent: media is a
// blind tunnel, and standing in front of it buys nothing but latency.
const HOSTS = [
    'youtube.com', '*.youtube.com',
    'google.com', '*.google.com',
    'googleapis.com', '*.googleapis.com',
    'gstatic.com', '*.gstatic.com',
    'ggpht.com', '*.ggpht.com'
];

const note = (what, detail) => postmortem.note('cobalt', `${what}: ${detail}`);

// -- where the container will look ---------------------------------------------------------------

// Our own config.xml, beside the bundle inside the widget. Reading it is how the service learns
// whether this package is configured for the container at all, and where its --content points —
// so the staging lands exactly where the switch says rather than at a path agreed by convention.
function switches() {
    try {
        const xml = fs.readFileSync(path.join(__dirname, '..', '..', 'config.xml'), 'utf8');
        const userdata = /native\.userdata"\s+value="([^"]*)"/.exec(xml);

        return userdata ? userdata[1].replace(/&quot;/g, '"') : null;
    } catch (e) {
        return null;
    }
}

function configuredContent() {
    if (process.env.TUBE_COBALT_CONTENT) return process.env.TUBE_COBALT_CONTENT;

    const content = /--content=(\S+)/.exec(switches() || '');
    return content ? content[1] : null;
}

// The container slot this package claims, or null when it claims none. Named by the pkgid
// metadata rather than by nativeID: carrying nativeID makes the launcher start the container
// *instead of* our own content, which leaves nothing to start the service first or to sequence
// the two. Without it our boot screen runs, waits for the service, and launches this itself.
const CONTAINER = 'com.samsung.tv.cobalt-yt';

function container() {
    const xml = switches();
    if (xml === null) return null;

    return /--content=|--base_url=/.test(xml) ? CONTAINER : null;
}

// Our own app id, read from the same config.xml rather than assembled from a package id and a
// guessed suffix.
function appId() {
    try {
        const xml = fs.readFileSync(path.join(__dirname, '..', '..', 'config.xml'), 'utf8');
        const found = /<tizen:application\s+id="([^"]+)"/.exec(xml);

        return found ? found[1] : null;
    } catch (e) {
        return null;
    }
}

// Reopening is where this falls down. The container the platform starts on a reopen dies at once —
// the viewer is thrown back out with a network error — while the identical
// `tizen.application.launch` issued from a service works every time, on both sets and on two
// different Tizen versions. Nothing of ours runs at launch to intervene, because a package carrying
// nativeID never runs its own content.
//
// But the service *is* told. Tizen's runner delivers a `wake` message and calls `onRequest` on our
// exports when the app is launched, so this is an event rather than a poll: on being woken, if the
// container is not up, issue the launch that works. The guard is only against a launch storm — one
// attempt, then quiet for a while, so a viewer who closes the app is never dragged back into it.
const RELAUNCH_QUIET = 20000;

let lastWake = 0;

function wake() {
    if (typeof tizen === 'undefined') return;

    const me = appId();
    if (!me || !container()) return;

    const now = Date.now();
    if (now - lastWake < RELAUNCH_QUIET) return;
    lastWake = now;

    tizen.application.getAppsContext((contexts) => {
        if (contexts.some((context) => context.appId === CONTAINER)) return;

        note('woken', `the container is not up; launching ${me}`);
        tizen.application.launch(me, () => {}, (error) => note('relaunch', `refused: ${error.message}`));
    }, () => {});
}

// The one value a package cannot derive is where the container should send its traffic, and the
// answer is to name the set rather than number it — Cobalt resolves the television's own hostname.
// That leans on the router registering DHCP names, so when it does not, say so: the alternative is
// a silent "network error" with nothing anywhere to explain it.
function checkAddress() {
    const proxy = /--proxy=http:\/\/([^:\s]+)/.exec(switches() || '');
    if (!proxy) return;

    const mine = [];
    const interfaces = os.networkInterfaces();
    Object.keys(interfaces).forEach((device) => {
        interfaces[device].forEach((address) => {
            if (!address.internal) mine.push(address.address);
        });
    });

    require('dns').lookup(proxy[1], { all: true }, (error, found) => {
        if (error) {
            return note('unreachable', `--proxy names ${proxy[1]}, which does not resolve here `
                + `(${error.code}). This set is ${os.hostname()} at ${mine.join(', ')}.`);
        }

        const addresses = found.map((entry) => entry.address);
        if (addresses.some((address) => mine.indexOf(address) !== -1)) return;

        note('misdirected', `--proxy names ${proxy[1]}, which resolves to ${addresses.join(', ')} `
            + `— not this set (${os.hostname()} at ${mine.join(', ')}).`);
    });
}

// -- staging -------------------------------------------------------------------------------------

function copyInto(from, to) {
    let copied = 0;

    fs.mkdirSync(to, { recursive: true });

    fs.readdirSync(from).forEach((entry) => {
        const source = path.join(from, entry);
        const target = path.join(to, entry);
        const info = fs.statSync(source);

        if (info.isDirectory()) {
            copied += copyInto(source, target);
            return;
        }

        // Same size is enough to call it done. These files never change in place — a firmware
        // update replaces the whole directory, and then the sizes move with it.
        try {
            if (fs.statSync(target).size === info.size) return;
        } catch (e) { /* absent, so copy it */ }

        fs.writeFileSync(target, fs.readFileSync(source));
        copied += 1;
    });

    return copied;
}

// About 5.1MB, nearly all of it icu/icudt68l.dat, and only on the first run.
function stageContent(target) {
    const copied = copyInto(STOCK, target);
    if (copied) note('staged', `${copied} files into ${target}`);

    return copied;
}

// -- the certificate authority ---------------------------------------------------------------

const read = (file) => fs.readFileSync(path.join(MITM_DIR, file), 'utf8');

function existingMaterial() {
    try {
        return {
            ca: JSON.parse(read('ca.json')),
            key: read('leaf.key'),
            chain: read('leaf-chain.crt')
        };
    } catch (e) {
        return null;
    }
}

// A leaf is good for 397 days; reissue it well before that rather than at the cliff, and reissue
// whenever the set of names it covers has changed.
function stillGood(material) {
    try {
        const cert = new (require('crypto').X509Certificate)(material.chain);
        const left = new Date(cert.validTo).getTime() - Date.now();
        const names = (cert.subjectAltName || '').replace(/DNS:/g, '').split(', ').sort().join();

        return left > 30 * 86400000 && names === HOSTS.slice().sort().join();
    } catch (e) {
        // No X509Certificate before Node 15. Trusting what is on disk beats refusing to run.
        return true;
    }
}

function issue(done) {
    const commonName = `Tube Local CA (${os.hostname()})`;

    x509.createCa(commonName, (error, ca) => {
        if (error) return done(error);

        x509.createLeaf(ca, 'www.youtube.com', HOSTS, (leafError, leaf) => {
            if (leafError) return done(leafError);

            fs.mkdirSync(MITM_DIR, { recursive: true });
            fs.writeFileSync(path.join(MITM_DIR, 'ca.crt'), ca.cert);
            fs.writeFileSync(path.join(MITM_DIR, 'ca.json'), JSON.stringify({ commonName, cert: ca.cert }));
            fs.writeFileSync(path.join(MITM_DIR, 'leaf-chain.crt'), leaf.chain);
            fs.writeFileSync(path.join(MITM_DIR, 'leaf.key'), leaf.key, { mode: 0o600 });

            note('issued', commonName);
            done(null, { ca: { commonName, cert: ca.cert }, key: leaf.key, chain: leaf.chain });
        });
    });
}

// The store is an OpenSSL hashed directory, so the file name is the lookup: <subject_hash>.0, and
// again under -subject_hash_old because which of the two is used depends on how the verifier was
// built. A name that is off by a byte is indistinguishable from an absent CA.
function installCa(certs, ca) {
    fs.mkdirSync(certs, { recursive: true });

    const hashes = x509.subjectHashes(ca.commonName);
    let written = 0;

    [hashes.hash, hashes.hashOld].forEach((hash) => {
        // A collision with one of the 133 roots already there would be remarkable, but stepping
        // the suffix is what OpenSSL itself does and it costs one line.
        for (let n = 0; n < 8; n += 1) {
            const file = path.join(certs, `${hash}.${n}`);
            let existing = null;
            try { existing = fs.readFileSync(file, 'utf8'); } catch (e) { /* free */ }

            if (existing === ca.cert) return;
            if (existing !== null) continue;

            fs.writeFileSync(file, ca.cert);
            written += 1;
            return;
        }
    });

    if (written) note('trusted', `${ca.commonName} as ${hashes.hash}.0 and ${hashes.hashOld}.0`);
}

// -- the whole thing ---------------------------------------------------------------------------

let prepared = null;
let preparing = false;

function prepare(done) {
    const finish = (error, result) => {
        preparing = false;
        if (error) note('failed', error.message);
        else prepared = result;
        if (done) done(error, result);
    };

    if (prepared || preparing) return done && done(null, prepared);
    preparing = true;

    // Whether this device has the container at all, reported either way and before anything else.
    // Not every Tizen device does — a Smart Monitor is not a television — and on a set where the
    // service cannot be reached any other way this one line is the whole diagnosis. It is written
    // even when the package is not configured for the container, because "is it there?" is exactly
    // the question one asks of a device where this has never worked.
    let container = false;
    try {
        container = fs.statSync(STOCK).isDirectory();
    } catch (e) { /* absent */ }

    note(container ? 'present' : 'absent', container
        ? `Cobalt is at ${STOCK}`
        : `nothing at ${STOCK} — ${os.hostname()} may not be a device that has the container`);

    const content = configuredContent();
    if (!content) return finish(null, null);

    checkAddress();

    if (!container) return finish(null, null);

    let material;
    try {
        stageContent(content);
        material = existingMaterial();
    } catch (e) {
        return finish(e);
    }

    if (material && stillGood(material)) {
        try { installCa(path.join(content, 'ssl', 'certs'), material.ca); } catch (e) { return finish(e); }
        return finish(null, material);
    }

    // Key generation is the slow part — seconds on this hardware — so it runs off the event loop
    // and the service answers normally while it happens.
    if (!x509.available()) return finish(null, null);

    issue((error, issued) => {
        if (error) return finish(error);

        try { installCa(path.join(content, 'ssl', 'certs'), issued.ca); } catch (e) { return finish(e); }
        finish(null, issued);
    });
}

// What forward.js needs to stand in front of a TLS connection, or null while it is still being
// made. Reads from disk so a service that started before the staging finished picks it up.
function material() {
    if (prepared) return { key: prepared.key, cert: prepared.chain };

    const existing = existingMaterial();
    if (!existing) return null;

    prepared = existing;
    return { key: existing.key, cert: existing.chain };
}

module.exports = { prepare, wake, material, configuredContent, container, HOSTS, MITM_DIR, STOCK };
