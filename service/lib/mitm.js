'use strict';

const tls = require('tls');
const fs = require('fs');

const dev = require('../dev/index.js');
const postmortem = require('./postmortem.js');

// A cobalt.js that fails to load disables interception, never the tunnel.
function cobaltIfItLoads() {
    try {
        return require('./cobalt.js');
    } catch (e) {
        postmortem.note('cobalt', `module would not load: ${postmortem.describe(e)}`);
        return null;
    }
}

const cobalt = cobaltIfItLoads();

const INTERCEPTED = ['youtube.com', 'googleapis.com', 'google.com', 'gstatic.com', 'ggpht.com'];

const RETRY_MATERIAL_EVERY = 3000;

// Every host is tunnelled untouched until the key material exists, and for good while a
// `disabled` file sits beside it.
const mitmConfig = () => {
    if (!cobalt) return null;

    try {
        return fs.existsSync(`${cobalt.MITM_DIR}/disabled`) ? null : cobalt.material();
    } catch (e) {
        return null;
    }
};

const isIntercepted = (host) => {
    const name = String(host || '').split(':')[0].toLowerCase();
    return INTERCEPTED.some((domain) => name === domain || name.endsWith(`.${domain}`));
};

const interceptor = (server, record) => {
    const held = { mitm: null, asked: 0 };

    const secureServer = (config) => {
        try {
            return tls.createServer(config, (socket) => {
                dev.journal.service('mitm', `secure ${socket.servername || '?'}`);
                record('accepted', socket.servername || '?');
                server.emit('connection', socket);
            });
        } catch (e) {
            return null;
        }
    };

    return () => {
        if (held.mitm) return held.mitm;
        if (Date.now() - held.asked < RETRY_MATERIAL_EVERY) return null;
        held.asked = Date.now();

        const config = mitmConfig();
        const mitm = config ? secureServer(config) : null;
        if (!mitm) return null;

        mitm.on('tlsClientError', (error, socket) => {
            dev.journal.service('mitm', `tls error ${error.message}`);
            record('refused', error.message);
            socket.destroy();
        });

        mitm.on('error', (error) => record('listener', postmortem.describe(error)));

        held.mitm = mitm;
        return mitm;
    };
};

module.exports = { INTERCEPTED, isIntercepted, interceptor };
