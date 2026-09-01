'use strict';

// Publishes what the page reports about playback, so the app can be inspected when sdbd
// refuses and there is no debugger. Readings travel one way: the page pushes, the network
// reads, and nothing arriving from the network is stored or run.

const express = require('express');
const cors = require('cors');

const ports = require('./ports.js');

// Readings older than this say so rather than being served as if current.
const STALE_AFTER = 10000;

let server = null;
let latest = null;
let receivedAt = 0;

/** The page's half, on this service's origin. Registered before the proxy's catch-all. */
function attach(app) {
    app.post('/__tube/dev/report', express.json({ limit: '256kb' }), (req, res) => {
        latest = req.body || null;
        receivedAt = Date.now();
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
    app.get('/stats', (_, res) => res.json(snapshot()));

    server = app.listen(ports.DEV, '0.0.0.0', () => {
        console.log(`[devbridge] reading port open on 0.0.0.0:${ports.DEV} (read-only).`);
    });

    server.on('error', (error) => {
        console.error(`[devbridge] could not open ${ports.DEV}: ${error.message}`);
        server = null;
    });

    return server;
}

function stop() {
    if (!server) return;
    try { server.close(); } catch (e) { /* already closing */ }
    server = null;
    latest = null;
    receivedAt = 0;
    console.log('[devbridge] reading port closed.');
}

module.exports = { attach, start, stop, isOpen: () => !!server };
