'use strict';

// Publishes what the page reports about playback, so the app can be inspected when sdbd
// refuses and there is no debugger. Readings travel one way: the page pushes, the network
// reads, and nothing arriving from the network is stored or run.

const crypto = require('crypto');
const express = require('express');
const cors = require('cors');

const ports = require('./ports.js');
const journal = require('./journal.js');
const postmortem = require('./postmortem.js');
const proxy = require('./proxy.js');
const sabr = require('./sabr.js');

// Readings older than this say so rather than being served as if current.
const STALE_AFTER = 10000;

// Baked for a debug build, random otherwise. Evaluate runs whatever it is handed, so it
// is not something a stranger on the network should be able to reach.
const BUILD_TOKEN = '__TUBE_DEV_TOKEN__';
const TOKEN = process.env.TUBE_DEV_TOKEN
    || (BUILD_TOKEN.indexOf('TUBE_DEV_TOKEN') === -1 ? BUILD_TOKEN : crypto.randomBytes(8).toString('hex'));

let server = null;
let latest = null;
let receivedAt = 0;
let queue = [];

// Answers waiting to be collected, by the id of the question. An asker that has given up
// leaves one behind, so they are dropped once they are older than anyone would wait.
const answers = new Map();
const ANSWER_KEPT = 60000;

function forget() {
    const now = Date.now();
    answers.forEach((held, id) => {
        if (now - held.at > ANSWER_KEPT) answers.delete(id);
    });
}

/** Asks the page something and waits for what it says. */
function ask(source, seconds) {
    const id = crypto.randomBytes(8).toString('hex');
    const deadline = Date.now() + (Math.min(Number(seconds) || 30, 120) * 1000);

    queue.push({ action: 'eval', source, id });

    return new Promise((resolve) => {
        const look = () => {
            const held = answers.get(id);
            if (held) {
                answers.delete(id);
                return resolve(held.answer);
            }

            if (Date.now() > deadline) {
                return resolve({ id, error: 'the page did not answer — is it open, with diagnostics on?' });
            }

            setTimeout(look, 50);
            return undefined;
        };

        look();
    });
}

/** The page's half, on this service's origin. Registered before the proxy's catch-all. */
function attach(app) {
    app.post('/__tube/dev/report', express.json({ limit: '256kb' }), (req, res) => {
        latest = req.body || null;
        receivedAt = Date.now();
        res.json({ received: true });
    });

    app.post('/__tube/dev/log', express.json({ limit: '256kb' }), (req, res) => {
        journal.fromPage((req.body || {}).lines);
        res.json({ received: true });
    });

    // Collected once: a command runs on the next poll and not on every one after it.
    app.get('/__tube/dev/commands', (_, res) => {
        const pending = queue;
        queue = [];
        res.json({ commands: pending });
    });

    // The page answering a question it was asked. Kept by id so an answer reaches whoever
    // asked rather than being matched by comparing the source text, which two questions
    // asked in the same second could both claim.
    app.post('/__tube/dev/result', express.json({ limit: '4mb' }), (req, res) => {
        const answer = req.body || {};
        if (answer.id) answers.set(String(answer.id), { at: Date.now(), answer });

        forget();
        res.json({ received: true });
    });

    // The app opens and closes it; nothing on the network can.
    app.all('/__tube/dev/enable', (req, res) => {
        const wanted = String((req.query && req.query.on) || '');
        if (wanted === '1' || wanted === 'true') start();
        if (wanted === '0' || wanted === 'false') stop();
        res.json({ open: !!server, port: ports.DEV });
    });
}

/** The reading half, on every interface, so a computer on the network can read it. */
function start() {
    if (server) return server;

    // Everything written for reading is written from here on, and not before.
    journal.open(true);

    const app = express();
    app.use(cors());

    const snapshot = () => ({
        ok: true,
        port: ports.DEV,
        age: receivedAt ? Math.round((Date.now() - receivedAt) / 1000) : null,
        stale: !receivedAt || Date.now() - receivedAt > STALE_AFTER,
        reading: latest
    });

    app.get('/health', (_, res) => res.json({ ok: true, port: ports.DEV, hasReading: !!latest }));

    // Can this set speak SABR at all? The page posts what it read out of the player
    // response and this reports what came back over the wire.
    app.post('/sabr/measure', express.json({ limit: '1mb' }), (req, res) => {
        const seconds = Math.min(Number(req.body && req.body.seconds) || 5, 20);

        sabr.measure(req.body || {}, seconds).then(
            (result) => res.json({ ok: true, result }),
            (error) => res.status(500).json({ ok: false, error: error.message })
        );
    });

    // What the proxy has learned about the session the page opened. The PO token comes
    // with it only for a caller holding the token, so the session cannot be lifted off
    // this port by anything else on the network.
    app.get('/sabr/session', (req, res) => {
        const session = sabr.observed.session;
        if (!session) return res.json({ seen: false });

        const trusted = (req.get('x-tube-token') || '') === TOKEN;

        res.json({
            seen: true,
            age: Math.round((Date.now() - session.at) / 1000),
            url: session.streamingUrl,
            hasPoToken: !!session.poToken,
            poToken: trusted ? session.poToken : undefined,
            ustreamerConfig: trusted ? session.ustreamerConfig : undefined
        });
    });

    // What this engine actually provides, so a library that needs streams or protobuf is
    // known to run here before anything is built on it.
    app.get('/runtime', (_, res) => {
        const has = (name) => typeof globalThis[name] !== 'undefined';
        const compiles = (source) => {
            try {
                new Function(source);
                return true;
            } catch (e) {
                return false;
            }
        };

        res.json({
            node: process.version,
            engine: process.versions,
            globals: {
                ReadableStream: has('ReadableStream'),
                WritableStream: has('WritableStream'),
                TransformStream: has('TransformStream'),
                TextDecoder: has('TextDecoder'),
                TextEncoder: has('TextEncoder'),
                fetch: has('fetch'),
                structuredClone: has('structuredClone'),
                BigInt: has('BigInt'),
                WeakRef: has('WeakRef'),
                Proxy: has('Proxy'),
                globalThis: typeof globalThis !== 'undefined'
            },
            syntax: {
                asyncAwait: compiles('return (async () => 1)'),
                asyncGenerators: compiles('return (async function* () { yield 1; })'),
                optionalChaining: compiles('return (o) => o?.a?.b'),
                nullishCoalescing: compiles('return (a) => a ?? 1'),
                classFields: compiles('return class { #x = 1; get x() { return this.#x; } }')
            }
        });
    });

    // One question, one answer, on one connection. Everything else here reads a reading
    // pushed on a timer; this waits for the page to actually run something and say what it
    // returned — including when what it returns is a promise.
    app.post('/eval', express.text({ limit: '256kb', type: '*/*' }), (req, res) => {
        if ((req.get('x-tube-token') || '') !== TOKEN) return res.status(403).json({ error: 'wrong token' });

        const source = String(req.body || '').trim();
        if (!source) return res.status(400).json({ error: 'nothing to evaluate' });

        return ask(source, req.query.seconds).then((answer) => res.json(answer));
    });

    // DEV: ask YouTube something with the app's own identity. The page cannot do this —
    // its fetch carries cookies but no bearer, which YouTube answers as a different client.
    app.post('/asplayer', express.json({ limit: '1mb' }), (req, res) => {
        if ((req.get('x-tube-token') || '') !== TOKEN) return res.status(403).json({ error: 'wrong token' });

        const path = String((req.body || {}).path || '/youtubei/v1/player?prettyPrint=false');
        const body = (req.body || {}).body;
        if (!body) return res.status(400).json({ error: 'no body' });

        return proxy.asPlayer(path, body, (req.body || {}).headers).then((answer) => res.json(
            Object.assign({ credentialsAgeMs: proxy.credentialsAge() }, answer)
        ));
    });

    app.get('/stats', (_, res) => res.json(snapshot()));

    // Everything both sides recorded, oldest first, as plain text to be read with `tail`.
    app.get('/log', (req, res) => {
        const count = Number(req.query && req.query.tail) || 0;
        res.type('text/plain').send(journal.read(count) || 'nothing recorded yet');
    });

    app.post('/log/clear', (_, res) => { journal.clear(); res.json({ cleared: true }); });

    // What stopped the service last time, which is otherwise unanswerable on a television.
    app.get('/postmortem', (_, res) => res.type('text/plain').send(postmortem.read() || 'nothing recorded'));

    // Queued for the page to run and report back in its next reading.
    app.post('/command', express.json({ limit: '64kb' }), (req, res) => {
        if ((req.get('x-tube-token') || '') !== TOKEN) return res.status(403).json({ error: 'bad token' });
        if (!req.body || !req.body.action) return res.status(400).json({ error: 'no action' });

        queue.push(req.body);
        res.json({ queued: req.body.action, depth: queue.length });
    });

    server = app.listen(ports.DEV, '0.0.0.0', () => {
        console.log(`[devbridge] open on 0.0.0.0:${ports.DEV}; commands need token ${TOKEN}.`);
    });

    server.on('error', (error) => {
        console.error(`[devbridge] could not open ${ports.DEV}: ${error.message}`);
        server = null;
    });

    return server;
}

function stop() {
    if (!server) return;
    journal.open(false);
    try { server.close(); } catch (e) { /* already closing */ }
    server = null;
    latest = null;
    receivedAt = 0;
    queue = [];
    console.log('[devbridge] reading port closed.');
}

module.exports = { attach, start, stop, isOpen: () => !!server };
