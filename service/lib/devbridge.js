'use strict';

const crypto = require('crypto');
const express = require('express');
const cors = require('cors');

const ports = require('./ports.js');
const journal = require('./journal.js');
const postmortem = require('./postmortem.js');
const sabr = require('./sabr.js');

const STALE_AFTER = 10000;

// /eval runs whatever it is handed; this token is what keeps the network out of it.
const BUILD_TOKEN = '__TUBE_DEV_TOKEN__';
const TOKEN = process.env.TUBE_DEV_TOKEN
    || (BUILD_TOKEN.indexOf('TUBE_DEV_TOKEN') === -1 ? BUILD_TOKEN : crypto.randomBytes(8).toString('hex'));

let server = null;
let latest = null;
let receivedAt = 0;
let queue = [];

const answers = new Map();
const ANSWER_KEPT = 60000;

function forget() {
    const now = Date.now();
    answers.forEach((held, id) => {
        if (now - held.at > ANSWER_KEPT) answers.delete(id);
    });
}

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

// Registered before the proxy's catch-all.
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

    app.get('/__tube/dev/commands', (_, res) => {
        const pending = queue;
        queue = [];
        res.json({ commands: pending });
    });

    app.post('/__tube/dev/result', express.json({ limit: '4mb' }), (req, res) => {
        const answer = req.body || {};
        if (answer.id) answers.set(String(answer.id), { at: Date.now(), answer });

        forget();
        res.json({ received: true });
    });

    app.all('/__tube/dev/enable', (req, res) => {
        const wanted = String((req.query && req.query.on) || '');
        if (wanted === '1' || wanted === 'true') start();
        if (wanted === '0' || wanted === 'false') stop();
        res.json({ open: !!server, port: ports.DEV });
    });
}

function start() {
    if (server) return server;

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

    app.post('/eval', express.text({ limit: '256kb', type: '*/*' }), (req, res) => {
        if ((req.get('x-tube-token') || '') !== TOKEN) return res.status(403).json({ error: 'wrong token' });

        const source = String(req.body || '').trim();
        if (!source) return res.status(400).json({ error: 'nothing to evaluate' });

        return ask(source, req.query.seconds).then((answer) => res.json(answer));
    });

    app.get('/stats', (_, res) => res.json(snapshot()));

    app.get('/log', (req, res) => {
        const count = Number(req.query && req.query.tail) || 0;
        res.type('text/plain').send(journal.read(count) || 'nothing recorded yet');
    });

    app.post('/log/clear', (_, res) => { journal.clear(); res.json({ cleared: true }); });

    app.get('/postmortem', (_, res) => res.type('text/plain').send(postmortem.read() || 'nothing recorded'));

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
    try { server.close(); } catch (e) { }
    server = null;
    latest = null;
    receivedAt = 0;
    queue = [];
    console.log('[devbridge] reading port closed.');
}

module.exports = { attach, start, stop };
