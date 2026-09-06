'use strict';

// A certificate issuer, small enough to carry.
//
// The container's trust store is a directory we stage a copy of, so the CA that signs our
// interception certificate has to be made somewhere. Making it *on the television* is the only
// arrangement that is safe to ship: one CA baked into a public release would put its private key
// in every download, and anyone holding it could impersonate Google to every set running this.
//
// Node cannot issue a certificate on its own — `crypto.X509Certificate` only parses — so the DER
// is written by hand here. It is less code than it looks: `createPublicKey().export()` does the
// key encoding, and `createSign()` does the signature.

const crypto = require('crypto');

// -- DER ---------------------------------------------------------------------------------------

function length(n) {
    if (n < 0x80) return Buffer.from([n]);

    const bytes = [];
    for (let value = n; value > 0; value = Math.floor(value / 256)) bytes.unshift(value % 256);

    return Buffer.concat([Buffer.from([0x80 | bytes.length]), Buffer.from(bytes)]);
}

const tagged = (tag, body) => Buffer.concat([Buffer.from([tag]), length(body.length), body]);

const sequence = (...parts) => tagged(0x30, Buffer.concat(parts));
const set = (...parts) => tagged(0x31, Buffer.concat(parts));
const utf8 = (text) => tagged(0x0c, Buffer.from(text, 'utf8'));
const octets = (body) => tagged(0x04, body);
const boolean = (yes) => tagged(0x01, Buffer.from([yes ? 0xff : 0x00]));
const explicit = (n, body) => tagged(0xa0 | n, body);
const implicit = (n, body) => tagged(0x80 | n, body);
const nul = Buffer.from([0x05, 0x00]);

// A DER INTEGER is signed, so a leading bit set needs a zero byte in front of it.
function integer(value) {
    let bytes = Buffer.isBuffer(value) ? value : Buffer.from([value]);
    while (bytes.length > 1 && bytes[0] === 0 && !(bytes[1] & 0x80)) bytes = bytes.slice(1);
    if (bytes[0] & 0x80) bytes = Buffer.concat([Buffer.from([0]), bytes]);

    return tagged(0x02, bytes);
}

// The unused-bits byte is always zero here: everything wrapped is a whole number of octets.
const bitString = (body) => tagged(0x03, Buffer.concat([Buffer.from([0]), body]));

function oid(dotted) {
    const parts = dotted.split('.').map(Number);
    const bytes = [parts[0] * 40 + parts[1]];

    parts.slice(2).forEach((part) => {
        const chunk = [part & 0x7f];
        for (let rest = Math.floor(part / 128); rest > 0; rest = Math.floor(rest / 128)) {
            chunk.unshift((rest & 0x7f) | 0x80);
        }
        bytes.push(...chunk);
    });

    return tagged(0x06, Buffer.from(bytes));
}

const OID = {
    commonName: '2.5.4.3',
    rsaEncryption: '1.2.840.113549.1.1.1',
    sha256WithRSA: '1.2.840.113549.1.1.11',
    basicConstraints: '2.5.29.19',
    keyUsage: '2.5.29.15',
    subjectAltName: '2.5.29.17',
    extKeyUsage: '2.5.29.37',
    serverAuth: '1.3.6.1.5.5.7.3.1',
    subjectKeyIdentifier: '2.5.29.14',
    authorityKeyIdentifier: '2.5.29.35'
};

// Two digits of the year, so this is a UTCTime — which is what every certificate before 2050 uses.
function utcTime(date) {
    const pad = (n) => String(n).padStart(2, '0');

    return tagged(0x17, Buffer.from(
        pad(date.getUTCFullYear() % 100) + pad(date.getUTCMonth() + 1) + pad(date.getUTCDate())
        + pad(date.getUTCHours()) + pad(date.getUTCMinutes()) + pad(date.getUTCSeconds()) + 'Z',
        'ascii'
    ));
}

// -- names -------------------------------------------------------------------------------------

// One CN is all this needs. The value is encoded as UTF8String so that the canonical form used for
// the directory hash differs from this only by case and spacing, both handled in canonical().
const name = (commonName) => sequence(set(sequence(oid(OID.commonName), utf8(commonName))));

// OpenSSL hashes the *canonical* encoding, not this one: values become UTF8String, ASCII letters
// fold to lower case, and runs of whitespace collapse to one space with the ends trimmed. Note
// there is no outer SEQUENCE — i2d_name_canon concatenates the RDN sets and stops, which is the
// one difference from the ordinary encoding that is easy to miss. Getting this wrong names the
// file something the container never looks for, and nothing says so; the handshake just fails as
// though the CA were absent. service/test/x509.js pins it against `openssl x509 -subject_hash`.
const canonical = (commonName) => set(sequence(
    oid(OID.commonName),
    utf8(commonName.replace(/\s+/g, ' ').trim().toLowerCase())
));

// `openssl x509 -subject_hash` and `-subject_hash_old`: the first four bytes of the digest, read
// little-endian. The new form is SHA-1 over the canonical encoding, the old MD5 over the raw DER.
function hashName(digest, encoded) {
    const md = crypto.createHash(digest).update(encoded).digest();

    return ((md[0] | (md[1] << 8) | (md[2] << 16) | (md[3] << 24)) >>> 0).toString(16).padStart(8, '0');
}

const subjectHashes = (commonName) => ({
    hash: hashName('sha1', canonical(commonName)),
    hashOld: hashName('md5', name(commonName))
});

// -- certificates ------------------------------------------------------------------------------

const algorithm = sequence(oid(OID.sha256WithRSA), nul);

// Built rather than exported, so the BIT STRING contents are in hand for the key identifier.
function publicKeyInfo(key) {
    const pkcs1 = crypto.createPublicKey(key).export({ type: 'pkcs1', format: 'der' });

    return {
        spki: sequence(sequence(oid(OID.rsaEncryption), nul), bitString(pkcs1)),
        identifier: crypto.createHash('sha1').update(pkcs1).digest()
    };
}

const extension = (id, critical, body) => (critical
    ? sequence(oid(id), boolean(true), octets(body))
    : sequence(oid(id), octets(body)));

// Bit 0 is digitalSignature and bit 5 keyCertSign, numbered from the most significant bit of the
// first byte — so the DER carries the count of unused trailing bits rather than a zero.
function keyUsage(bits) {
    const highest = Math.max(...bits);
    const bytes = Buffer.alloc(Math.floor(highest / 8) + 1);
    bits.forEach((bit) => { bytes[Math.floor(bit / 8)] |= 0x80 >> (bit % 8); });

    const unused = 7 - (highest % 8);
    return tagged(0x03, Buffer.concat([Buffer.from([unused]), bytes]));
}

function certificate(options) {
    const { subject, issuer, subjectKey, issuerKey, days, extensions } = options;

    const from = new Date();
    const to = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);

    const tbs = sequence(
        explicit(0, integer(Buffer.from([2]))),            // v3
        integer(crypto.randomBytes(16)),
        algorithm,
        name(issuer),
        sequence(utcTime(from), utcTime(to)),
        name(subject),
        subjectKey.spki,
        explicit(3, sequence(...extensions))
    );

    const signature = crypto.createSign('RSA-SHA256').update(tbs).sign(issuerKey);
    const der = sequence(tbs, algorithm, bitString(signature));

    return {
        der,
        pem: `-----BEGIN CERTIFICATE-----\n${
            der.toString('base64').replace(/(.{64})/g, '$1\n').replace(/\n$/, '')
        }\n-----END CERTIFICATE-----\n`
    };
}

function generateKey(done) {
    crypto.generateKeyPair('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' }
    }, (error, publicKey, privateKey) => done(error, error ? null : { publicKey, privateKey }));
}

// A certificate authority, valid for ten years and trusted by nothing but the copy of Cobalt's
// content directory we stage beside it.
function createCa(commonName, done) {
    generateKey((error, key) => {
        if (error) return done(error);

        const info = publicKeyInfo(key.publicKey);
        const cert = certificate({
            subject: commonName,
            issuer: commonName,
            subjectKey: info,
            issuerKey: key.privateKey,
            days: 3650,
            extensions: [
                extension(OID.basicConstraints, true, sequence(boolean(true))),
                extension(OID.keyUsage, true, keyUsage([5, 6])),   // keyCertSign, cRLSign
                extension(OID.subjectKeyIdentifier, false, octets(info.identifier))
            ]
        });

        done(null, { key: key.privateKey, cert: cert.pem, identifier: info.identifier, commonName });
    });
}

// 397 days, and it must stay under 398: Chromium refuses a longer-lived leaf, and Cobalt has no
// notion of a locally added root that would be exempt from that rule — everything in the staged
// ssl/certs *is* its built-in store.
function createLeaf(ca, commonName, altNames, done) {
    generateKey((error, key) => {
        if (error) return done(error);

        const info = publicKeyInfo(key.publicKey);
        const cert = certificate({
            subject: commonName,
            issuer: ca.commonName,
            subjectKey: info,
            issuerKey: ca.key,
            days: 397,
            extensions: [
                extension(OID.basicConstraints, true, sequence()),
                extension(OID.keyUsage, true, keyUsage([0, 2])),   // digitalSignature, keyEncipherment
                extension(OID.extKeyUsage, false, sequence(oid(OID.serverAuth))),
                extension(OID.subjectAltName, false, sequence(...altNames.map((host) => implicit(2, Buffer.from(host, 'ascii'))))),
                extension(OID.subjectKeyIdentifier, false, octets(info.identifier)),
                extension(OID.authorityKeyIdentifier, false, sequence(implicit(0, ca.identifier)))
            ]
        });

        done(null, { key: key.privateKey, cert: cert.pem, chain: cert.pem + ca.cert });
    });
}

// Node 4 has no key generation at all, and the container route does not exist on a set that old.
const available = () => typeof crypto.generateKeyPair === 'function';

module.exports = { available, createCa, createLeaf, subjectHashes };
