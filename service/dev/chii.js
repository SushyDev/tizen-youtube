'use strict';

// Serves chii's target script and routes its socket under the page's own origin.

const fetch = require('node-fetch');
const postmortem = require('../lib/postmortem.js');

// `off` means no inspector, because injectTokens refuses an empty value.
const CHII_TOKEN = '__TUBE_CHII__';
const CHII = CHII_TOKEN === 'off' ? '' : CHII_TOKEN;

const MOUNT = '/__tube/chii/';

const pathIn = (url) => {
    const raw = String(url || '');
    const at = raw.indexOf(MOUNT);
    if (at === -1) return null;

    return raw.slice(at + MOUNT.length - 1) || '/';
};

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
