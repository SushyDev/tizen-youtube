'use strict';

// The remote inspector's server side: serving its target script, and routing the socket that
// script opens.
//
// Both halves have to arrive under the page's own origin. Cobalt sends HTTP through --proxy but
// not WebSockets, so a socket opened straight to the laptop bypasses the proxy, cannot reach the
// LAN from inside the container, and closes 1006 — measured on the set. Addressed to youtube.com
// they come through our own TLS front like everything else, and are forwarded from here. That is
// the only route out of that page either half has.

const postmortem = require('../lib/postmortem.js');

// Baked in at build time, not read from the environment: this runs on the television, which has
// none of the laptop's variables. `off` is the sentinel for "no inspector configured", because
// the token substitution refuses an empty value.
const CHII_TOKEN = '__TUBE_CHII__';
const CHII = CHII_TOKEN === 'off' ? '' : CHII_TOKEN;

// One prefix, borrowed by both halves, so the page can address the inspector without knowing
// where it is. Everything under it is the inspector's own path with this taken off the front.
const MOUNT = '/__tube/chii/';

// Null rather than a path when the URL is not ours, which is most of them: this is asked on every
// upgrade the page makes, including YouTube's own lounge socket.
const pathIn = (url) => {
    const raw = String(url || '');
    const at = raw.indexOf(MOUNT);
    if (at === -1) return null;

    return raw.slice(at + MOUNT.length - 1) || '/';
};

// Where an upgrade under the mount is really going. The address is a parameter rather than read
// from the build token, so this is answerable without one.
const targetFor = (url, where) => {
    const path = pathIn(url);
    if (!path || !where) return null;

    const [host, port] = String(where).split(':');
    if (!host) return null;

    return { host, port: Number(port) || 80, path, secure: false };
};

const upgradeRewrite = (req) => targetFor(req && req.url, CHII);

const routes = (app) => {
    if (!CHII) return;

    app.get(`${MOUNT}*`, (req, res) => {
        const path = pathIn(req.originalUrl) || '/';

        fetch(`http://${CHII}${path}`)
            .then((answer) => answer.text().then((body) => {
                res.status(answer.status);
                res.type(answer.headers.get('content-type') || 'application/javascript');
                res.send(body);
            }))
            .catch((error) => {
                postmortem.note('chii', `${path} — ${postmortem.describe(error)}`);
                res.status(502).type('application/javascript')
                    .send(`console.error(${JSON.stringify(`tube: chii at ${CHII} is not answering`)});`);
            });
    });
};

module.exports = { routes, upgradeRewrite, targetFor, MOUNT };
