'use strict';

// The player reports an attestation refusal only as a timeout, so the STREAM_PROTECTION_STATUS
// googlevideo opens each UMP answer with is the one place it shows.

const postmortem = require('./postmortem.js');

const PART = 58;
const FIELD_ONE = 0x08;
const STATUS = { 1: 'ok', 2: 'pending (grace period)', 3: 'required (attestation refused)' };
const MOST = 20;

const seen = new Set();

// The part and its status are both single-byte varints in every answer seen.
const statusOf = (chunk) => (chunk && chunk[0] === PART && chunk[1] < 128 && chunk[2] === FIELD_ONE
    ? chunk[3]
    : null);

const watch = (url, body) => {
    if (String(url).indexOf('/videoplayback') === -1) return;

    body.once('data', (chunk) => {
        const status = statusOf(chunk);
        if (status === null) return;

        // SABR carries its formats in the body, so its URL names no itag.
        const itag = (/[?&]itag=(\d+)/.exec(url) || [])[1];
        const what = itag ? `itag ${itag}` : 'SABR';
        const key = `${what}:${status}`;
        if (seen.has(key) || seen.size >= MOST) return;

        seen.add(key);
        postmortem.note('media', `${what}: protection ${STATUS[status] || status}`);
    });
};

module.exports = { statusOf, watch };
