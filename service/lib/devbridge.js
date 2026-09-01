'use strict';

// A way to see what the app is doing when the debugger is out of reach.
//
// The CDP path only exists while sdbd will accept a connection, and on this platform it
// often will not — it refuses most attempts and sometimes wedges until the set is
// restarted. When that happens the app falls back to the proxy, no debug port is opened,
// and there is no way to ask the running page anything from a computer.
//
// Two facts make a way through. The page served by the proxy is same-origin with this
// service, so it can report to it. And this process already binds a port on every
// interface for DIAL, so a second one is reachable from the network the set is on.
//
// It carries readings in one direction only. The page decides what to report and pushes
// it; the network can read that and nothing else. Nothing arriving from the network is
// evaluated, stored or acted on — a debugging aid should not also be a way into a
// television that is signed into somebody's account.

const express = require('express');
const cors = require('cors');

const ports = require('./ports.js');

// Readings older than this say so rather than being served as if current.
const STALE_AFTER = 10000;

let server = null;
let latest = null;
let receivedAt = 0;

/**
 * The page's half, on the service's own origin. Registered on the main app before the
 * proxy's catch-all.
 */
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
