'use strict';

// Everything the container route needs that a package cannot carry, derived on the set: a
// writable copy of Cobalt's content directory, and the certificate authority that sits in it.
// One CA baked into a public release would put its private key in every download.

const fs = require('fs');
const os = require('os');
const path = require('path');
const dns = require('dns');

const x509 = require('./x509.js');
const postmortem = require('./postmortem.js');

const STOCK = '/usr/apps/com.samsung.tv.cobalt/content/app/cobalt/content';

// Named by pkgid metadata rather than nativeID: carrying nativeID makes the launcher start the
// container instead of our own content, so nothing is left to start the service or sequence the
// two.
const CONTAINER = 'com.samsung.tv.cobalt-yt';

const SHARE = process.env.TUBE_SHARE || '/home/owner/share/tube';
const MITM_DIR = process.env.TUBE_MITM_DIR || path.join(SHARE, 'mitm');

const CONFIG = path.join(__dirname, '..', '..', 'config.xml');

// googlevideo is deliberately absent: media is a blind tunnel, and standing in front of it buys
// nothing but latency.
const HOSTS = [
    'youtube.com', '*.youtube.com',
    'google.com', '*.google.com',
    'googleapis.com', '*.googleapis.com',
    'gstatic.com', '*.gstatic.com',
    'ggpht.com', '*.ggpht.com'
];

const REISSUE_WITHIN = 30 * 86400000;
const RELAUNCH_QUIET = 20000;

const note = (what, detail) => postmortem.note('cobalt', `${what}: ${postmortem.describe(detail)}`);

const state = { config: undefined, prepared: null, preparing: false, lastWake: 0, waiting: [] };

const config = () => {
    if (state.config === undefined) {
        try {
            state.config = fs.readFileSync(CONFIG, 'utf8');
        } catch (e) {
            state.config = null;
        }
    }

    return state.config;
};

// Our own switches, so the staging lands where --content says rather than by convention.
const switches = () => {
    const found = /native\.userdata"\s+value="([^"]*)"/.exec(config() || '');
    return found ? found[1].replace(/&quot;/g, '"') : null;
};

const configuredContent = () => {
    if (process.env.TUBE_COBALT_CONTENT) return process.env.TUBE_COBALT_CONTENT;

    const found = /--content=(\S+)/.exec(switches() || '');
    return found ? found[1] : null;
};

// The container slot this package claims, or null when it claims none.
const container = () => {
    if (config() === null) return null;

    return /--content=|--base_url=/.test(switches() || '') ? CONTAINER : null;
};

const appId = () => {
    const found = /<tizen:application\s+id="([^"]+)"/.exec(config() || '');
    return found ? found[1] : null;
};

const addresses = () => {
    const interfaces = os.networkInterfaces();

    return Object.keys(interfaces).reduce(
        (all, device) => all.concat(interfaces[device].map((entry) => entry.address)), []
    );
};

// Loopback is this set, whichever loopback it is. The switch names 127.0.0.2 precisely because
// that is a fixed way of saying "here" — only 127.0.0.1 appears in the interface list, so
// comparing against that alone reports the one configuration that is always right as misdirected.
const isLoopback = (address) => address === '::1' || String(address).indexOf('127.') === 0;

// Cobalt resolves the set's own hostname, which leans on the router registering DHCP names. When
// it does not, the alternative is a silent network error with nothing anywhere to explain it.
const checkAddress = () => {
    const named = /--proxy=http:\/\/([^:\s]+)/.exec(switches() || '');
    if (!named) return;

    const mine = addresses();
    const here = `This set is ${os.hostname()} at ${mine.join(', ')}.`;

    dns.lookup(named[1], { all: true }, (error, found) => {
        if (error) {
            return note('unreachable', `--proxy names ${named[1]}, which does not resolve here `
                + `(${error.code}). ${here}`);
        }

        const resolved = found.map((entry) => entry.address);
        const ours = (address) => isLoopback(address) || mine.indexOf(address) !== -1;

        if (resolved.some(ours)) return undefined;

        return note('misdirected', `--proxy names ${named[1]}, which resolves to `
            + `${resolved.join(', ')} — not this set. ${here}`);
    });
};

// Reopening is where this falls down: the container the platform starts on a reopen dies at once,
// while the identical launch issued from a service works every time. Tizen calls onRequest on our
// exports when the app is launched, so this is an event rather than a poll. The guard is only
// against a launch storm — a viewer who closes the app must not be dragged back in.
const wake = () => {
    if (typeof tizen === 'undefined') return;

    const me = appId();
    if (!me || !container()) return;

    const now = Date.now();
    if (now - state.lastWake < RELAUNCH_QUIET) return;
    state.lastWake = now;

    tizen.application.getAppsContext((contexts) => {
        if (contexts.some((context) => context.appId === CONTAINER)) return;

        note('woken', `the container is not up; launching ${me}`);
        tizen.application.launch(me, () => {}, (error) => note('relaunch', `refused: ${error.message}`));
    }, () => {});
};

// About 5.1MB, nearly all of it icu/icudt68l.dat, and only on the first run. Same size is enough
// to call a file done: a firmware update replaces the whole directory.
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

const read = (file) => fs.readFileSync(path.join(MITM_DIR, file), 'utf8');

const existingMaterial = () => {
    try {
        return { ca: JSON.parse(read('ca.json')), key: read('leaf.key'), chain: read('leaf-chain.crt') };
    } catch (e) {
        return null;
    }
};

// Reissue well before the cliff, and whenever the set of names has changed.
const stillGood = (material) => {
    try {
        const cert = new (require('crypto').X509Certificate)(material.chain);
        const left = new Date(cert.validTo).getTime() - Date.now();
        const names = (cert.subjectAltName || '').replace(/DNS:/g, '').split(', ').sort().join();

        return left > REISSUE_WITHIN && names === HOSTS.slice().sort().join();
    } catch (e) {
        // No X509Certificate before Node 15. Trusting what is on disk beats refusing to run.
        return true;
    }
};

const issue = (done) => {
    const commonName = `Tube Local CA (${os.hostname()})`;

    x509.createCa(commonName, (error, ca) => {
        if (error) return done(error);

        return x509.createLeaf(ca, 'www.youtube.com', HOSTS, (leafError, leaf) => {
            if (leafError) return done(leafError);

            try {
                fs.mkdirSync(MITM_DIR, { recursive: true });
                fs.writeFileSync(path.join(MITM_DIR, 'ca.crt'), ca.cert);
                fs.writeFileSync(path.join(MITM_DIR, 'ca.json'), JSON.stringify({ commonName, cert: ca.cert }));
                fs.writeFileSync(path.join(MITM_DIR, 'leaf-chain.crt'), leaf.chain);
                fs.writeFileSync(path.join(MITM_DIR, 'leaf.key'), leaf.key, { mode: 0o600 });
            } catch (writeError) {
                return done(writeError);
            }

            note('issued', commonName);
            return done(null, { ca: { commonName, cert: ca.cert }, key: leaf.key, chain: leaf.chain });
        });
    });
};

// The store is an OpenSSL hashed directory, so the file name is the lookup: <subject_hash>.0, and
// again under -subject_hash_old because which is used depends on how the verifier was built. A
// name off by a byte is indistinguishable from an absent CA.
const installCa = (certs, ca) => {
    fs.mkdirSync(certs, { recursive: true });

    const hashes = x509.subjectHashes(ca.commonName);

    const place = (hash) => {
        for (let suffix = 0; suffix < 8; suffix += 1) {
            const file = path.join(certs, `${hash}.${suffix}`);

            const existing = (() => {
                try { return fs.readFileSync(file, 'utf8'); } catch (e) { return null; }
            })();

            if (existing === ca.cert) return 'already there';
            if (existing !== null) continue;

            fs.writeFileSync(file, ca.cert);
            return 'written';
        }

        return 'no free slot';
    };

    const placed = [hashes.hash, hashes.hashOld].map((hash) => `${hash}.0 ${place(hash)}`);

    note('trusted', `${ca.commonName} — ${placed.join(', ')}`);
};

const prepare = (done) => {
    const finish = (error, result) => {
        state.preparing = false;

        if (error) note('failed', error);
        else state.prepared = result;

        const waiting = state.waiting.splice(0, state.waiting.length);
        return waiting.forEach((waiter) => waiter(error, result));
    };

    if (done) state.waiting.push(done);

    if (state.prepared) return done ? done(null, state.prepared) : undefined;

    // Held rather than answered: telling a caller "finished, nothing to do" while the work is
    // still running reports an empty result as a real one.
    if (state.preparing) return undefined;

    state.preparing = true;

    // Reported either way and before anything else: on a set the service cannot be reached from,
    // this one line is the whole diagnosis. Not every Tizen device has the container.
    const present = (() => {
        try { return fs.statSync(STOCK).isDirectory(); } catch (e) { return false; }
    })();

    note(present ? 'present' : 'absent', present
        ? `Cobalt is at ${STOCK}`
        : `nothing at ${STOCK} — ${os.hostname()} may not be a device that has the container`);

    const content = configuredContent();
    if (!content) return finish(null, null);

    checkAddress();

    if (!present) return finish(null, null);

    const material = (() => {
        try {
            const copied = copyInto(STOCK, content);
            if (copied) note('staged', `${copied} files into ${content}`);

            return existingMaterial();
        } catch (e) {
            finish(e);
            return undefined;
        }
    })();

    if (material === undefined) return undefined;

    const trust = (issued) => {
        try {
            installCa(path.join(content, 'ssl', 'certs'), issued.ca);
        } catch (e) {
            return finish(e);
        }

        return finish(null, issued);
    };

    if (material && stillGood(material)) return trust(material);

    // Key generation is seconds on this hardware, so it runs off the event loop and the service
    // answers normally while it happens.
    if (!x509.available()) return finish(null, null);

    return issue((error, issued) => (error ? finish(error) : trust(issued)));
};

// What forward.js needs to stand in front of a TLS connection, or null while it is still being
// made. Read from disk so a service that started before the staging finished picks it up.
const material = () => {
    if (state.prepared) return { key: state.prepared.key, cert: state.prepared.chain };

    const existing = existingMaterial();
    if (!existing) return null;

    state.prepared = existing;
    return { key: existing.key, cert: existing.chain };
};

module.exports = { prepare, wake, material, container, MITM_DIR };
