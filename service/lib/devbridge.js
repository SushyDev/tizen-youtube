'use strict';

const crypto = require('crypto');
const { once } = require('events');
const express = require('express');
const cors = require('cors');

const ports = require('./ports.js');
const journal = require('./journal.js');
const postmortem = require('./postmortem.js');

const STALE_AFTER = 10000;
const PAGE_LATENCY = 2000;
const MOST_QUEUED = 64;

// /eval runs whatever it is handed; this token is what keeps the network out of it.
const BUILD_TOKEN = '__TUBE_DEV_TOKEN__';
const TOKEN = process.env.TUBE_DEV_TOKEN
    || (BUILD_TOKEN.indexOf('TUBE_DEV_TOKEN') === -1 ? BUILD_TOKEN : crypto.randomBytes(8).toString('hex'));

const state = { server: null, latest: null, receivedAt: 0, queue: [], waiting: {} };

const trusted = (req, res, next) => ((req.get('x-tube-token') || '') === TOKEN
    ? next()
    : res.status(403).json({ error: 'wrong token' }));

const enqueue = (command) => {
    state.queue = state.queue.concat([command]).slice(-MOST_QUEUED);

    return state.queue.length;
};

const settle = (id, answer) => {
    const waiter = state.waiting[id];
    if (!waiter) return;

    clearTimeout(waiter.timer);
    state.waiting = Object.fromEntries(Object.entries(state.waiting).filter(([key]) => key !== id));
    waiter.resolve(answer);
};

const ask = (source, seconds) => {
    const id = crypto.randomBytes(8).toString('hex');
    const wait = Math.min(Number(seconds) || 30, 120) * 1000;

    enqueue({ action: 'eval', source, id, wait });

    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            state.queue = state.queue.filter((command) => command.id !== id);
            settle(id, { id, error: 'the page did not answer — is it open, with diagnostics on?' });
        }, wait + PAGE_LATENCY);

        state.waiting = Object.assign({}, state.waiting, { [id]: { resolve, timer } });
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

    app.post('/eval', express.text({ limit: '256kb', type: '*/*' }), trusted, (req, res) => {
        const source = String(req.body || '').trim();
        if (!source) return res.status(400).json({ error: 'nothing to evaluate' });

        return ask(source, req.query.seconds).then((answer) => res.json(answer));
    });

    app.post('/command', express.json({ limit: '64kb' }), trusted, (req, res) => {
        if (!req.body || req.body.action !== 'eval') return res.status(400).json({ error: 'not an eval' });

        return res.json({ queued: req.body.action, depth: enqueue(req.body) });
    });

    state.server = app.listen(ports.DEV, '0.0.0.0', () => {
        console.log(`[devbridge] open on 0.0.0.0:${ports.DEV}; commands need token ${TOKEN}.`);
    });

    state.server.on('error', (error) => {
        postmortem.note('devbridge', `could not open ${ports.DEV}: ${postmortem.describe(error)}`);

        const failed = state.server;
        state.server = null;
        journal.open(false);

        if (failed) failed.close();
    });

    return state.server;
};

const stop = () => {
    if (!state.server) return;

    journal.open(false);
    state.server.close();

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
        if (answer.id) settle(String(answer.id), answer);

        res.json({ received: true });
    });

    app.all('/__tube/dev/enable', (req, res) => {
        const asked = String((req.query && req.query.on) || '');
        const reply = () => res.json({ open: !!state.server, port: ports.DEV });

        if (asked === '1' || asked === 'true') start();
        if (asked === '0' || asked === 'false') stop();

        if (!state.server || state.server.listening) return reply();

        return once(state.server, 'listening').then(reply, reply);
    });
};

module.exports = { attach };
