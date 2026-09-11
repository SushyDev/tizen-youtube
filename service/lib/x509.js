'use strict';

// Issues a CA and leaf certificates by writing the DER directly, since Node's crypto cannot.

const crypto = require('crypto');

// -- DER -----------------------------------------------------------------------------------------

const length = (n) => {
    if (n < 0x80) return Buffer.from([n]);

    const base256 = (value) => (value > 0 ? base256(Math.floor(value / 256)).concat(value % 256) : []);

    const bytes = base256(n);

    return Buffer.concat([Buffer.from([0x80 | bytes.length]), Buffer.from(bytes)]);
};

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
const integer = (value) => {
    const withoutLeadingZeroes = (bytes) => (
        bytes.length > 1 && bytes[0] === 0 && !(bytes[1] & 0x80)
            ? withoutLeadingZeroes(bytes.slice(1))
            : bytes
    );

    const trimmed = withoutLeadingZeroes(Buffer.isBuffer(value) ? value : Buffer.from([value]));

    return tagged(0x02, trimmed[0] & 0x80 ? Buffer.concat([Buffer.from([0]), trimmed]) : trimmed);
};

// Everything wrapped here is a whole number of octets, so the unused-bits byte is always zero.
const bitString = (body) => tagged(0x03, Buffer.concat([Buffer.from([0]), body]));

const oid = (dotted) => {
    const parts = dotted.split('.').map(Number);

    const carry = (rest) => (rest > 0 ? carry(Math.floor(rest / 128)).concat((rest & 0x7f) | 0x80) : []);

    const varint = (part) => carry(Math.floor(part / 128)).concat(part & 0x7f);

    const encoded = parts.slice(2).reduce(
        (bytes, part) => bytes.concat(varint(part)),
        [parts[0] * 40 + parts[1]]
    );

    return tagged(0x06, Buffer.from(encoded));
};

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

const KEY_USAGE = { digitalSignature: 0, keyEncipherment: 2, keyCertSign: 5, cRLSign: 6 };

const CA_DAYS = 3650;

// Chromium refuses a leaf valid for more than 398 days.
const LEAF_DAYS = 397;

// UTCTime, which is what every certificate before 2050 uses.
const utcTime = (date) => {
    const pad = (n) => String(n).padStart(2, '0');

    return tagged(0x17, Buffer.from(
        pad(date.getUTCFullYear() % 100) + pad(date.getUTCMonth() + 1) + pad(date.getUTCDate())
        + pad(date.getUTCHours()) + pad(date.getUTCMinutes()) + pad(date.getUTCSeconds()) + 'Z',
        'ascii'
    ));
};

// -- names ---------------------------------------------------------------------------------------

const name = (commonName) => sequence(set(sequence(oid(OID.commonName), utf8(commonName))));

// OpenSSL hashes the canonical name: UTF8String values, ASCII lower-cased, whitespace collapsed,
// RDN sets concatenated without an outer SEQUENCE.
const canonical = (commonName) => set(sequence(
    oid(OID.commonName),
    utf8(commonName.replace(/\s+/g, ' ').trim().toLowerCase())
));

// The first four bytes of the digest, read little-endian: SHA-1 over the canonical encoding for
// -subject_hash, MD5 over the raw DER for -subject_hash_old.
const hashName = (digest, encoded) => {
    const md = crypto.createHash(digest).update(encoded).digest();

    return ((md[0] | (md[1] << 8) | (md[2] << 16) | (md[3] << 24)) >>> 0).toString(16).padStart(8, '0');
};

const subjectHashes = (commonName) => ({
    hash: hashName('sha1', canonical(commonName)),
    hashOld: hashName('md5', name(commonName))
});

// -- certificates --------------------------------------------------------------------------------

const algorithm = sequence(oid(OID.sha256WithRSA), nul);

// Built rather than exported, so the BIT STRING contents are in hand for the key identifier.
const publicKeyInfo = (key) => {
    const pkcs1 = crypto.createPublicKey(key).export({ type: 'pkcs1', format: 'der' });

    return {
        spki: sequence(sequence(oid(OID.rsaEncryption), nul), bitString(pkcs1)),
        identifier: crypto.createHash('sha1').update(pkcs1).digest()
    };
};

const extension = (id, critical, body) => (critical
    ? sequence(oid(id), boolean(true), octets(body))
    : sequence(oid(id), octets(body)));

// Numbered from the most significant bit of the first byte, so the DER carries the count of unused
// trailing bits rather than a zero.
const keyUsage = (bits) => {
    const highest = Math.max(...bits);

    const byteAt = (index) => bits
        .filter((bit) => Math.floor(bit / 8) === index)
        .reduce((byte, bit) => byte | (0x80 >> (bit % 8)), 0);

    const bytes = Buffer.from(Array.from({ length: Math.floor(highest / 8) + 1 }, (_, i) => byteAt(i)));

    return tagged(0x03, Buffer.concat([Buffer.from([7 - (highest % 8)]), bytes]));
};

const certificate = ({ subject, issuer, subjectKey, issuerKey, days, extensions }) => {
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

    const der = sequence(tbs, algorithm, bitString(crypto.createSign('RSA-SHA256').update(tbs).sign(issuerKey)));

    return {
        der,
        pem: `-----BEGIN CERTIFICATE-----\n${
            der.toString('base64').replace(/(.{64})/g, '$1\n').replace(/\n$/, '')
        }\n-----END CERTIFICATE-----\n`
    };
};

const generateKey = (done) => crypto.generateKeyPair('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' }
}, (error, publicKey, privateKey) => done(error, error ? null : { publicKey, privateKey }));

const createCa = (commonName, done) => generateKey((error, key) => {
    if (error) return done(error);

    const info = publicKeyInfo(key.publicKey);

    const cert = certificate({
        subject: commonName,
        issuer: commonName,
        subjectKey: info,
        issuerKey: key.privateKey,
        days: CA_DAYS,
        extensions: [
            extension(OID.basicConstraints, true, sequence(boolean(true))),
            extension(OID.keyUsage, true, keyUsage([KEY_USAGE.keyCertSign, KEY_USAGE.cRLSign])),
            extension(OID.subjectKeyIdentifier, false, octets(info.identifier))
        ]
    });

    return done(null, { key: key.privateKey, cert: cert.pem, identifier: info.identifier, commonName });
});

const createLeaf = (ca, commonName, altNames, done) => generateKey((error, key) => {
    if (error) return done(error);

    const info = publicKeyInfo(key.publicKey);

    const cert = certificate({
        subject: commonName,
        issuer: ca.commonName,
        subjectKey: info,
        issuerKey: ca.key,
        days: LEAF_DAYS,
        extensions: [
            extension(OID.basicConstraints, true, sequence()),
            extension(OID.keyUsage, true, keyUsage([KEY_USAGE.digitalSignature, KEY_USAGE.keyEncipherment])),
            extension(OID.extKeyUsage, false, sequence(oid(OID.serverAuth))),
            extension(OID.subjectAltName, false,
                sequence(...altNames.map((host) => implicit(2, Buffer.from(host, 'ascii'))))),
            extension(OID.subjectKeyIdentifier, false, octets(info.identifier)),
            extension(OID.authorityKeyIdentifier, false, sequence(implicit(0, ca.identifier)))
        ]
    });

    return done(null, { key: key.privateKey, cert: cert.pem, chain: cert.pem + ca.cert });
});

// Node 4 has no key generation at all, and the container route does not exist on a set that old.
const available = () => typeof crypto.generateKeyPair === 'function';

module.exports = { available, createCa, createLeaf, subjectHashes };
