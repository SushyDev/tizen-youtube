'use strict';

// TEMPORARY, for the Cobalt attestation investigation. Records the handful of exchanges that
// decide whether media keeps flowing — the attestation challenge, the token mint, the player
// response and the media requests themselves — to a newline-delimited JSON file the laptop can
// pull off the set. Delete this file, and its call sites in proxy.js, once the stall is
// understood.

const fs = require('fs');
const crypto = require('crypto');

const FILE = '/home/owner/share/tube/exchange.ndjson';
const KEEP_BYTES = 8192;
const MAX_ENTRIES = 600;

let written = 0;
let started = 0;

// Only the exchanges that bear on attestation. Everything else is noise at this volume.
function tagFor(url) {
    if (url.indexOf('jnn-pa') !== -1) return 'attest';
    if (url.indexOf('/att/get') !== -1 || url.indexOf('/att/log') !== -1) return 'challenge';
    if (url.indexOf('videoplayback') !== -1) return 'media';
    if (url.indexOf('/youtubei/v1/player') !== -1) return 'player';
    if (url.indexOf('initplayback') !== -1) return 'onesie';
    return null;
}

function record(entry) {
    if (written >= MAX_ENTRIES) return;
    if (!started) started = Date.now();

    written += 1;
    try {
        fs.appendFileSync(FILE, `${JSON.stringify(Object.assign({ at: Date.now() - started }, entry))}\n`);
    } catch (e) { /* not on the set */ }
}

// Keep comparisons useful without putting bearer material or attestation payloads in the log.
// Equal hashes prove the exact wire body was reused across a state transition.
function fingerprint(value) {
    if (!value || !value.length) return null;
    return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
}

// UMP part 58 is STREAM_PROTECTION_STATUS: 1 accepted, 2 a warning that a refusal is coming, 3
// refused. Reading it here rather than from the size of the answer, because a short answer is not
// the same thing as a refused one and mistaking the two costs a whole run.
function protectionStatus(buffer) {
    let at = 0;

    const varint = () => {
        let value = 0;
        let shift = 0;
        while (at < buffer.length) {
            const byte = buffer[at++];
            value |= (byte & 0x7f) << shift;
            if ((byte & 0x80) === 0) break;
            shift += 7;
        }
        return value;
    };

    while (at < buffer.length) {
        const type = varint();
        const size = varint();
        if (size < 0 || at + size > buffer.length) return 0;
        if (type === 58 && size >= 2 && buffer[at] === 0x08) return buffer[at + 1];
        at += size;
    }
    return 0;
}

// The player response is the one body worth keeping whole — it is where the media URLs live, and
// 8KB of it says nothing.
function keepWhole(name, text) {
    try { fs.writeFileSync(`/home/owner/share/tube/${name}.json`, text); } catch (e) { /* not on the set */ }
}

// Buffers the head of a stream without holding on to the rest of it.
function keepHead(stream, done) {
    const parts = [];
    let total = 0;

    stream.on('data', (chunk) => {
        total += chunk.length;
        if (total <= KEEP_BYTES) parts.push(chunk);
    });
    stream.on('end', () => done(Buffer.concat(parts), total));
    stream.on('error', () => done(Buffer.concat(parts), total));
}

module.exports = { tagFor, record, fingerprint, keepHead, keepWhole, protectionStatus, KEEP_BYTES, FILE };
