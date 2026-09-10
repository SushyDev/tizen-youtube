'use strict';

// The proxy the app is served through. youtube.com comes back from here so the userscript can be
// injected into it and the page can reach anything it needs to.
//
// What is left in this file is the express application itself: the middleware every request passes
// through, and the fallback that stands in for youtube.com. Where a request is going is route.js,
// what is changed on the way is rewrites.js, and getting it there is sending.js.

const express = require('express');

const loader = require('./loader.js');
const forward = require('./forward.js');
const dev = require('../dev/index.js');
const ports = require('./ports.js');
const postmortem = require('./postmortem.js');
const { upstream } = require('./knobs.js');
const { PROXY_HOST, localOrigin, proxyPrefix } = require('./origin.js');
const { YOUTUBE_ORIGIN, overOurTls, routeFor, headersFor } = require('./route.js');
const { send } = require('./sending.js');
const { nonceOf, rewriteAttestation, rewriteBody, rerouteAbr, rewriteSetCookie, withOurGrants } = require('./rewrites.js');

const TEXTUAL = ['text/html', 'application/json', 'javascript', 'text/css'];
const STRIPPED_HEADERS = ['content-encoding', 'content-length', 'transfer-encoding', 'alt-svc'];
const CSP_HEADER = 'content-security-policy';

// How many intercepted requests to write to the log on disk before falling quiet: inside the
// container this is the only record of what was asked for, and it must not fill the partition.
const TRACE_LIMIT = 40;

const state = { traced: 0 };

// A wildcard is refused for a request that carries cookies, so when the page names itself the
// answer names it back.
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

    app.use((req, _, next) => {
        const watching = dev.journal.wanted();
        const tracing = state.traced < TRACE_LIMIT;
        if (!watching && !tracing) return next();

        // req.url, not originalUrl: the forward-proxy form has already been put back to a path.
        const path = String(req.url || req.originalUrl);
        const ours = path.indexOf('/__tube/') === 0;
        const asked = `${req.method} ${path.slice(0, 150)}`;

        // Our own /__tube/ requests would drown the page's in the journal.
        if (watching && !ours) dev.journal.service('asked', overOurTls(req) ? `${asked} host=${req.headers.host || '?'}` : asked);

        if (tracing && overOurTls(req) && !ours) {
            state.traced += 1;
            postmortem.note('req', `${req.method} ${req.headers.host || '?'}${path.slice(0, 120)}`);
        }

        return next();
    });

    // A credentialed preflight reads `*` as a refusal, so the origin of our own pages and the
    // headers asked for are named back.
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
            res.type('application/javascript').send(loader.resolve().source);
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

    // SABR redirects between googlevideo hosts, so Location is pointed back through /cors-bypass/
    // or the hop fails CORS.
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
        const headers = headersFor(req, route);

        // An unhandled 'error' on the response socket is an uncaught exception, and the postmortem
        // handler answers those by exiting.
        res.on('error', () => res.destroy());

        // Never leave the client waiting on a request we have given up on: the container answers a
        // hung page by retrying for ever behind a network error.
        const fail = (what, error) => {
            postmortem.note('upstream', `${what} on ${route.url.slice(0, 90)}: ${postmortem.describe(error)}`);
            dev.journal.service('failed', `${what} ${route.url.slice(0, 110)}`);

            if (res.headersSent) return res.destroy();
            return res.status(500).type('text/plain').send(`tube: ${what}`);
        };

        return send(route.url, req, headers)
            .then((response) => {
                res.status(response.status);

                if (route.isBypass) dev.journal.service('answered', `${response.status} ${route.url.slice(0, 110)}`);

                copyHeaders(req, res, response, route);

                const contentType = response.headers.get('content-type') || '';
                const textual = TEXTUAL.some((type) => contentType.indexOf(type) !== -1);

                if (!textual) {
                    if (!response.body) return res.end();

                    // A viewer who closes the page leaves a media stream being pulled into a socket
                    // nothing reads; and a source that breaks mid-pipe would otherwise hang the
                    // client for ever.
                    res.on('close', () => response.body.destroy());
                    response.body.on('error', (error) => fail('upstream stream broke', error));

                    return response.body.pipe(res);
                }

                return response.text().then((text) => {
                    const injectionOrigin = route.asTheRealHost && req.headers.host
                        ? `https://${req.headers.host}`
                        : null;
                    const nonce = route.asTheRealHost ? nonceOf(response.headers.get(CSP_HEADER)) : null;

                    const injected = rewriteAttestation(
                        rewriteBody(text, req.url, injectionOrigin, nonce), route.url
                    );

                    const abr = upstream.abrThroughService && route.url.indexOf('/youtubei/v1/player') !== -1;

                    res.send(abr ? rerouteAbr(injected) : injected);
                });
            })
            .catch((error) => fail('upstream failed', error));
    });

    return app;
};
module.exports = { create, attachFallback };
