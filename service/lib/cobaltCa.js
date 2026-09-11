'use strict';

// A per-set CA, made on first run, because a shipped one would publish its private key.

const fs = require('fs');
const os = require('os');
const path = require('path');

const x509 = require('./x509.js');
const postmortem = require('./postmortem.js');

const SHARE = process.env.TUBE_SHARE || '/home/owner/share/tube';
const MITM_DIR = process.env.TUBE_MITM_DIR || path.join(SHARE, 'mitm');

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

// OpenSSL steps <hash>.0, .1, .2 … when a name collides.
const SLOTS = 8;

const note = (what, detail) => postmortem.note('cobalt', `${what}: ${postmortem.describe(detail)}`);

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

    const contentsOf = (file) => {
        try { return fs.readFileSync(file, 'utf8'); } catch (e) { return null; }
    };

    // A collision with one of the roots already there would be remarkable, but stepping the suffix
    // is what OpenSSL itself does, and the log has to name the file it really wrote.
    const place = (hash) => {
        const slots = Array.from({ length: SLOTS }, (_, suffix) => ({
            suffix,
            file: path.join(certs, `${hash}.${suffix}`)
        }));

        const already = slots.find((slot) => contentsOf(slot.file) === ca.cert);
        if (already) return `${hash}.${already.suffix} already there`;

        const free = slots.find((slot) => contentsOf(slot.file) === null);
        if (!free) return `${hash} has no free slot`;

        fs.writeFileSync(free.file, ca.cert);
        return `${hash}.${free.suffix} written`;
    };

    const hashes = x509.subjectHashes(ca.commonName);

    note('trusted', `${ca.commonName} — ${[hashes.hash, hashes.hashOld].map(place).join(', ')}`);
};

module.exports = { MITM_DIR, HOSTS, existingMaterial, stillGood, issue, installCa };
