'use strict';

const express = require('express');

const { USER_SCRIPT, read } = require('./shipped.js');
const forward = require('./forward.js');
const dev = require('../dev/index.js');
const ports = require('./ports.js');
const postmortem = require('./postmortem.js');
const protection = require('./protection.js');
const { upstream } = require('./knobs.js');
const { PROXY_HOST, localOrigin, proxyPrefix } = require('./origin.js');
const { YOUTUBE_ORIGIN, overOurTls, routeFor, headersFor } = require('./route.js');
const { readText, send } = require('./sending.js');
const {
    nonceOf, rewriteAttestation, rewriteBody, rerouteAbr, rewriteSetCookie, withOurGrants,
    hidesWatermark, withHiddenWatermark, rewriteStaticHosts
} = require('./rewrites.js');

// A cobalt.js that fails to load costs Evergreen's offers, never the proxy.
const cobalt = require('./cobaltIfItLoads.js')();

// Cobalt's own update check, read for the package it is offered.
const UPDATE_CHECK = 'https://tools.google.com/service/update2/json';

const TEXTUAL = ['text/html', 'application/json', 'javascript', 'text/css'];
const STRIPPED_HEADERS = ['content-encoding', 'content-length', 'transfer-encoding', 'alt-svc'];
const CSP_HEADER = 'content-security-policy';

// Inside the container this log is the only record of what was asked for, and it must not fill
// the partition.
const TRACE_LIMIT = 40;

const state = { traced: 0 };

// Readable.destroy arrived in node 8.
const release = (stream) => (typeof stream.destroy === 'function' ? stream.destroy() : stream.unpipe().resume());

// A wildcard is refused for a request that carries cookies.
const allowOrigin = (req, res) => {
    const asked = req.get('origin');
    res.setHeader('Access-Control-Allow-Origin', asked || '*');
    if (asked) res.setHeader('Access-Control-Allow-Credentials', 'true');
};

const create = () => {
    const app = express();

    app.use((req, _, next) => {
        forward.normaliseSelf(req, PROXY_HOST, ports.PROXY);
        next();
    });

    app.use((req, res, next) => {
        const watching = dev.journal.wanted();
        const tracing = state.traced < TRACE_LIMIT;
        if (!watching && !tracing) return next();

        // req.url, not originalUrl: the forward-proxy form has already been put back to a path.
        const path = String(req.url || req.originalUrl);
        const ours = path.indexOf('/__tube/') === 0;
        const asked = `${req.method} ${path.slice(0, 150)}`;

        // Our own /__tube/ requests would drown the page's in the journal.
        if (watching && !ours) dev.journal.service('asked', overOurTls(req) ? `${asked} host=${req.headers.host || '?'}` : asked);

        if (tracing && !ours) {
            state.traced += 1;
            res.on('finish', () => postmortem.note('req',
                `${req.method} ${req.headers.host || '?'}${path.slice(0, 110)} → ${res.statusCode}`));
        }

        return next();
    });

    // A credentialed preflight reads `*` as a refusal.
    app.use((req, res, next) => {
        const asked = req.get('origin');
        const ours = asked === YOUTUBE_ORIGIN || asked === localOrigin();

        res.setHeader('Access-Control-Allow-Origin', ours ? asked : '*');
        if (ours) res.setHeader('Access-Control-Allow-Credentials', 'true');

        if (req.method !== 'OPTIONS') return next();

        res.setHeader('Vary', 'Origin, Access-Control-Request-Headers');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
        res.setHeader('Access-Control-Allow-Headers', req.get('access-control-request-headers') || '*');
        res.setHeader('Access-Control-Max-Age', '86400');

        return res.status(200).end();
    });

    app.get('/__tube/userScript.js', (_, res) => {
        try {
            res.type('application/javascript').send(read(USER_SCRIPT));
        } catch (e) {
            postmortem.note('userscript', e);
            res.status(500).type('application/javascript')
                .send(`console.error(${JSON.stringify(`tube: no userscript available - ${e.message}`)});`);
        }
    });

    dev.pageRoutes(app);

    return app;
};
const copyHeaders = (req, res, response, route) => {
    const raw = response.headers.raw();

    Object.keys(raw).forEach((key) => {
        const lower = key.toLowerCase();

        if (STRIPPED_HEADERS.indexOf(lower) !== -1) return;

        // Kept for the real host, because YouTube's policy carries Cobalt's private-address grants.
        if (lower === CSP_HEADER) {
            if (!route.asTheRealHost) return;

            res.setHeader(key, raw[key].map(withOurGrants));
            return;
        }
        if (route.isBypass && lower === 'access-control-allow-origin') return;

        // A page on the real host would reject a cookie rewritten to Domain=localhost.
        if (lower === 'set-cookie' && Array.isArray(raw[key])) {
            res.setHeader('Set-Cookie', route.asTheRealHost ? raw[key] : rewriteSetCookie(raw[key]));
            return;
        }

        res.setHeader(key, response.headers.get(key));
    });

    allowOrigin(req, res);

    // SABR redirects between googlevideo hosts, and a hop that leaves the bypass fails CORS.
    const movedTo = response.status >= 300 && response.status < 400 && response.headers.get('location');
    if (route.isBypass && movedTo && /^https?:\/\//.test(movedTo)) {
        res.setHeader('Location', proxyPrefix() + movedTo);
    }
};

// Must be called after every other route is registered.
const attachFallback = (app) => {
    app.all('*', (req, res) => {
        // A failed initplayback makes the client fall back to a plain player response.
        if (upstream.onesie === 'fail' && req.url.indexOf('initplayback') !== -1) {
            dev.journal.service('onesie', `refused ${req.method}`);
            return res.status(502).end();
        }

        const route = routeFor(req);

        // Served as ourselves, the page has to say so in its own URL before kabuki reads it.
        if (!route.asTheRealHost && req.path === '/tv' && !hidesWatermark(req.url)) {
            return res.redirect(302, withHiddenWatermark(req.url));
        }

        const headers = headersFor(req, route);

        // An unhandled 'error' on the response socket is an uncaught exception, and the postmortem
        // handler answers those by exiting.
        res.on('error', () => res.destroy());

        // The container answers a hung page by retrying for ever behind a network error.
        const fail = (what, error) => {
            postmortem.note('upstream', `${what} on ${route.url.slice(0, 90)}: ${postmortem.describe(error)}`);
            dev.journal.service('failed', `${what} ${route.url.slice(0, 110)}`);

            if (res.headersSent) return res.destroy();
            return res.status(500).type('text/plain').send(`tube: ${what}`);
        };

        return send(route.url, req, headers)
            .then((response) => {
                if (route.isBypass) dev.journal.service('answered', `${response.status} ${route.url.slice(0, 110)}`);

                const contentType = response.headers.get('content-type') || '';
                const textual = TEXTUAL.some((type) => contentType.indexOf(type) !== -1);

                if (!textual) {
                    res.status(response.status);
                    copyHeaders(req, res, response, route);

                    if (!response.body) return res.end();

                    // A break after the viewer dropped the stream is our own release, not upstream's.
                    const dropped = { yes: false };
                    res.on('close', () => {
                        dropped.yes = true;
                        release(response.body);
                    });
                    response.body.on('error', (error) => {
                        if (!dropped.yes) fail('upstream stream broke', error);
                    });
                    protection.watch(route.url, response.body);

                    return response.body.pipe(res);
                }

                return readText(response, route.url, req, headers).then(({ response: source, text }) => {
                    if (cobalt && route.url.indexOf(UPDATE_CHECK) === 0) cobalt.heardOffer(text);

                    res.status(source.status);
                    copyHeaders(req, res, source, route);

                    const injectionOrigin = route.asTheRealHost && req.headers.host
                        ? `https://${req.headers.host}`
                        : null;
                    const nonce = route.asTheRealHost ? nonceOf(source.headers.get(CSP_HEADER)) : null;

                    const html = rewriteBody(text, req.url, injectionOrigin, nonce);

                    // The real host reaches attestation itself; otherwise the page hooks do.
                    const injected = route.asTheRealHost || upstream.nativeProxyPatches
                        ? html
                        : rewriteAttestation(html);

                    // Served as ourselves, engine-loaded statics must not inherit our http origin.
                    const served = route.asTheRealHost ? injected : rewriteStaticHosts(injected);

                    const abr = upstream.abrThroughService && route.url.indexOf('/youtubei/v1/player') !== -1;

                    res.send(abr ? rerouteAbr(served) : served);
                });
            })
            .catch((error) => fail('upstream failed', error));
    });

    return app;
};
const retrace = () => {
    state.traced = 0;
};

module.exports = { create, attachFallback, retrace };
