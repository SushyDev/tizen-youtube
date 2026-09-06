'use strict';

const crypto = require('crypto');
const express = require('express');
const cors = require('cors');

const ports = require('./ports.js');
const journal = require('./journal.js');
const postmortem = require('./postmortem.js');

const STALE_AFTER = 10000;
const ANSWER_KEPT = 60000;
const MOST_QUEUED = 64;

// /eval runs whatever it is handed; this token is what keeps the network out of it.
const BUILD_TOKEN = '__TUBE_DEV_TOKEN__';
const TOKEN = process.env.TUBE_DEV_TOKEN
    || (BUILD_TOKEN.indexOf('TUBE_DEV_TOKEN') === -1 ? BUILD_TOKEN : crypto.randomBytes(8).toString('hex'));

const answers = new Map();

const state = { server: null, latest: null, receivedAt: 0, queue: [] };

const trusted = (req) => (req.get('x-tube-token') || '') === TOKEN;

const enqueue = (command) => {
    state.queue.push(command);
    state.queue.splice(0, Math.max(0, state.queue.length - MOST_QUEUED));

    return state.queue.length;
};

const ask = (source, seconds) => {
    const id = crypto.randomBytes(8).toString('hex');
    const deadline = Date.now() + (Math.min(Number(seconds) || 30, 120) * 1000);

    enqueue({ action: 'eval', source, id });

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

            return setTimeout(look, 50);
        };

        look();
    });
};

const forget = () => {
    const now = Date.now();

    answers.forEach((held, id) => {
        if (now - held.at > ANSWER_KEPT) answers.delete(id);
    });
};

const start = () => {
    if (state.server) return state.server;

    journal.open(true);

    const app = express();
    app.use(cors());

    app.get('/health', (_, res) => res.json({ ok: true, port: ports.DEV, hasReading: !!state.latest }));

    app.get('/stats', (_, res) => res.json({
        ok: true,
        port: ports.DEV,
        age: state.receivedAt ? Math.round((Date.now() - state.receivedAt) / 1000) : null,
        stale: !state.receivedAt || Date.now() - state.receivedAt > STALE_AFTER,
        reading: state.latest
    }));

    app.get('/log', (req, res) => res.type('text/plain')
        .send(journal.read(Number(req.query && req.query.tail) || 0) || 'nothing recorded yet'));

    app.post('/log/clear', (_, res) => { journal.clear(); res.json({ cleared: true }); });

    app.get('/postmortem', (_, res) => res.type('text/plain').send(postmortem.read() || 'nothing recorded'));

    app.post('/eval', express.text({ limit: '256kb', type: '*/*' }), (req, res) => {
        if (!trusted(req)) return res.status(403).json({ error: 'wrong token' });

        const source = String(req.body || '').trim();
        if (!source) return res.status(400).json({ error: 'nothing to evaluate' });

        return ask(source, req.query.seconds).then((answer) => res.json(answer));
    });

    app.post('/command', express.json({ limit: '64kb' }), (req, res) => {
        if (!trusted(req)) return res.status(403).json({ error: 'bad token' });
        if (!req.body || !req.body.action) return res.status(400).json({ error: 'no action' });

        return res.json({ queued: req.body.action, depth: enqueue(req.body) });
    });

    state.server = app.listen(ports.DEV, '0.0.0.0', () => {
        console.log(`[devbridge] open on 0.0.0.0:${ports.DEV}; commands need token ${TOKEN}.`);
    });

    // Closed, not just forgotten: dropping the handle leaks a server per failure, and the next
    // /__tube/dev/enable builds a second app and listens on the same port again.
    state.server.on('error', (error) => {
        postmortem.note('devbridge', `could not open ${ports.DEV}: ${postmortem.describe(error)}`);

        const failed = state.server;
        state.server = null;
        journal.open(false);

        if (failed) try { failed.close(); } catch (e) { /* never listened */ }
    });

    return state.server;
};

const stop = () => {
    if (!state.server) return;

    journal.open(false);
    try { state.server.close(); } catch (e) { /* already going */ }

    state.server = null;
    state.latest = null;
    state.receivedAt = 0;
    state.queue = [];

    console.log('[devbridge] reading port closed.');
};

// Registered before the proxy's catch-all.
const attach = (app) => {
    app.post('/__tube/dev/report', express.json({ limit: '256kb' }), (req, res) => {
        state.latest = req.body || null;
        state.receivedAt = Date.now();
        res.json({ received: true });
    });

    app.post('/__tube/dev/log', express.json({ limit: '256kb' }), (req, res) => {
        journal.fromPage((req.body || {}).lines);
        res.json({ received: true });
    });

    app.get('/__tube/dev/commands', (_, res) => {
        const pending = state.queue;
        state.queue = [];
        res.json({ commands: pending });
    });

    app.post('/__tube/dev/result', express.json({ limit: '4mb' }), (req, res) => {
        const answer = req.body || {};
        if (answer.id) answers.set(String(answer.id), { at: Date.now(), answer });

        forget();
        res.json({ received: true });
    });

    app.all('/__tube/dev/enable', (req, res) => {
        const asked = String((req.query && req.query.on) || '');

        if (asked === '1' || asked === 'true') start();
        if (asked === '0' || asked === 'false') stop();

        res.json({ open: !!state.server, port: ports.DEV });
    });
};

module.exports = { attach };
