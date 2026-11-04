'use strict';

// Cobalt in the container runs on UTC, so the page tells YouTube it sits at +0 and every time
// YouTube writes out for it, a premiere or a scheduled live, comes out an hour or two early.
// The service runs on the set's own clock, which knows where the set is.

const zlib = require('zlib');

const OFFSET_HEADER = 'x-youtube-utc-offset';
const NAME_HEADER = 'x-youtube-time-zone';

const tizenName = () => {
    try {
        return typeof tizen === 'undefined' || !tizen.time ? null : tizen.time.getLocalTimezone() || null;
    } catch (e) {
        return null;
    }
};

// Read each time rather than once: the service outlives a change to or from summer time.
const current = () => ({ utcOffsetMinutes: -new Date().getTimezoneOffset(), timeZone: tizenName() });

// Only headers the page already sends are corrected, so a request that never named a zone still
// does not.
const correctHeaders = (headers, zone) => {
    if (!(OFFSET_HEADER in headers)) return headers;

    const named = zone.timeZone ? { [NAME_HEADER]: zone.timeZone } : {};
    return Object.assign({}, headers, { [OFFSET_HEADER]: String(zone.utcOffsetMinutes) }, named);
};

// What the page needs to put the same zone in its request bodies.
const pageTag = (zone) => `<script>window.__TUBE_ZONE__=${JSON.stringify(zone)};</script>`;

// The page's own hook (mods/network/zone.js) misses requests built by a module that keeps its own
// JSON, and the player's scheduled-live text came back in UTC. Innertube bodies are small, so the
// service reads them whole and puts the zone in the client context itself.
const INNERTUBE = /^https:\/\/www\.youtube\.com\/youtubei\/v1\//;

const carriesContext = (method, url) => method === 'POST' && INNERTUBE.test(url);

const parsed = (text) => {
    try {
        return JSON.parse(text);
    } catch (e) {
        return null;
    }
};

// The text unchanged unless it is JSON with a client context.
const correctBody = (text, zone) => {
    const body = parsed(text);
    const client = body && body.context && body.context.client;
    if (!client || typeof client !== 'object') return text;

    client.utcOffsetMinutes = zone.utcOffsetMinutes;
    if (zone.timeZone) client.timeZone = zone.timeZone;

    return JSON.stringify(body);
};

// Buffer.from(string) arrived in node 4.5; on 4.4 it is TypedArray.from.
const bytesOf = (text) => (Buffer.from && Buffer.from !== Uint8Array.from ? Buffer.from(text, 'utf8') : new Buffer(text, 'utf8'));

// null for an encoding it can't read, or bytes that don't unpack.
const readable = (raw, encoding) => {
    try {
        if (encoding === 'gzip') return zlib.gunzipSync(raw).toString('utf8');
        if (encoding === 'deflate') return zlib.inflateSync(raw).toString('utf8');
        return encoding ? null : raw.toString('utf8');
    } catch (e) {
        return null;
    }
};

// Reads the request, corrects it and resolves the bytes to send with the headers that go with them.
// Anything it can't read goes on as it arrived.
const correctRequest = (req, headers, zone) => new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('error', reject);
    req.on('end', () => {
        const raw = Buffer.concat(chunks);
        const encoding = String(headers['content-encoding'] || '').toLowerCase();

        const text = readable(raw, encoding);
        const corrected = text === null ? text : correctBody(text, zone);
        if (corrected === null || corrected === text) return resolve({ body: raw, headers });

        const body = bytesOf(corrected);
        const sent = Object.assign({}, headers, { 'content-length': String(body.length) });
        delete sent['content-encoding'];
        delete sent['transfer-encoding'];

        return resolve({ body, headers: sent });
    });
});

module.exports = { current, correctHeaders, pageTag, carriesContext, correctBody, correctRequest };
