'use strict';

// The certificate issuer, checked against the tool that defines the format. Every one of these
// failures is silent on a television — a certificate the container will not accept, or a file
// named something it never looks for — so they are worth catching here.

const { execFileSync } = require('child_process');
const { mkdtempSync, writeFileSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');

const x509 = require('../lib/x509.js');

let failures = 0;

function check(label, ok, detail) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  ${detail}`}`);
    if (!ok) failures += 1;
}

const dir = mkdtempSync(join(tmpdir(), 'tube-x509-'));
const openssl = (args) => execFileSync('openssl', args, { encoding: 'utf8' });

// The pair of names the certificate that first worked inside the container was filed under, taken
// off the television. It costs nothing to check and it pins the hash to a value observed in the
// wild rather than only to whatever openssl on this machine happens to say.
const known = x509.subjectHashes('Tube Cobalt Experiment CA');
check('the hashes reproduce a name that worked on the set',
    known.hash === '24de7fb5' && known.hashOld === '147bf03f', JSON.stringify(known));

const CA_NAME = 'Tube Local CA On This Set';
const HOSTS = ['youtube.com', '*.youtube.com', 'googlevideo.com', '*.googlevideo.com'];

x509.createCa(CA_NAME, (error, ca) => {
    if (error) {
        check('the CA is issued', false, error.message);
        return process.exit(1);
    }

    const caPath = join(dir, 'ca.crt');
    writeFileSync(caPath, ca.cert);

    // A certificate openssl cannot parse fails here rather than on the set.
    const text = openssl(['x509', '-in', caPath, '-noout', '-text']);
    check('the CA parses', text.indexOf('Signature Algorithm: sha256WithRSAEncryption') !== -1);
    check('the CA is a CA', /CA:TRUE/.test(text), text.slice(0, 200));
    check('the CA can sign certificates', /Certificate Sign/.test(text));
    check('the CA carries a subject key identifier', /Subject Key Identifier/.test(text));

    // The whole point of the exercise: the file name the container looks for.
    const ours = x509.subjectHashes(CA_NAME);
    const theirs = openssl(['x509', '-in', caPath, '-noout', '-subject_hash']).trim();
    const theirsOld = openssl(['x509', '-in', caPath, '-noout', '-subject_hash_old']).trim();

    check('subject_hash matches openssl', ours.hash === theirs, `${ours.hash} vs ${theirs}`);
    check('subject_hash_old matches openssl', ours.hashOld === theirsOld, `${ours.hashOld} vs ${theirsOld}`);

    x509.createLeaf(ca, 'www.youtube.com', HOSTS, (leafError, leaf) => {
        if (leafError) {
            check('the leaf is issued', false, leafError.message);
            return process.exit(1);
        }

        const leafPath = join(dir, 'leaf.crt');
        writeFileSync(leafPath, leaf.cert);
        const leafText = openssl(['x509', '-in', leafPath, '-noout', '-text']);

        check('the leaf chains to the CA', openssl(['verify', '-CAfile', caPath, leafPath]).indexOf('OK') !== -1);
        check('the leaf is not a CA', /CA:FALSE/.test(leafText) || !/CA:TRUE/.test(leafText));
        check('the leaf is for server authentication', /TLS Web Server Authentication/.test(leafText));

        HOSTS.forEach((host) => {
            check(`the leaf names ${host}`, leafText.indexOf(`DNS:${host}`) !== -1);
        });

        // Over 398 days and Chromium refuses it outright, which is what the whole round cost.
        const dates = openssl(['x509', '-in', leafPath, '-noout', '-dates']);
        const from = new Date(/notBefore=(.*)/.exec(dates)[1]);
        const to = new Date(/notAfter=(.*)/.exec(dates)[1]);
        const days = Math.round((to - from) / 86400000);
        check('the leaf lives inside the 398-day limit', days > 0 && days < 398, `${days} days`);

        // The private key has to match, or the handshake dies with no useful message.
        writeFileSync(join(dir, 'leaf.key'), leaf.key);
        const keyModulus = openssl(['rsa', '-in', join(dir, 'leaf.key'), '-noout', '-modulus']);
        const certModulus = openssl(['x509', '-in', leafPath, '-noout', '-modulus']);
        check('the leaf key matches the leaf', keyModulus === certModulus);

        check('the chain carries both certificates', leaf.chain.split('BEGIN CERTIFICATE').length === 3);

        console.log(failures ? `\n${failures} failed.` : '\nall checks passed');
        process.exit(failures ? 1 : 0);
    });
});
