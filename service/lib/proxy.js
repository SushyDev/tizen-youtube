'use strict';

const express = require('express');
const fetch = require('node-fetch');
const http = require('http');
const https = require('https');
const URL = require('url');
const { readFileSync } = require('fs');

const ports = require('./ports.js');
const loader = require('./loader.js');
const journal = require('./journal.js');
const postmortem = require('./postmortem.js');

const AGENT_OPTIONS = { keepAlive: true, keepAliveMsecs: 15000 };
const httpsAgent = new https.Agent(AGENT_OPTIONS);
const httpAgent = new http.Agent(AGENT_OPTIONS);
const agentFor = (url) => (String(url).indexOf('https:') === 0 ? httpsAgent : httpAgent);

const DEV_USER_AGENT = process.env.TUBE_DEV_UA || '';
const DEV_INJECT_PATH = process.env.TUBE_DEV_INJECT || '';

const TEXTUAL = ['text/html', 'application/json', 'javascript', 'text/css'];
const STRIPPED_HEADERS = [
    'content-encoding', 'content-length', 'transfer-encoding', 'content-security-policy', 'alt-svc'
];
const BODIED = ['POST', 'PUT', 'PATCH'];

const YOUTUBE_HOST = 'www.youtube.com';
const YOUTUBE_ORIGIN = `https://${YOUTUBE_HOST}`;

// Node 12 hands out dead keep-alive sockets without retrying, so a bodiless request gets one retry
// on a fresh connection.
const RETRIABLE = ['ECONNRESET', 'EPIPE', 'ETIMEDOUT'];

const GOOGLE = /(^|\.)(youtube\.com|googlevideo\.com|googleapis\.com|google\.com|ggpht\.com|gstatic\.com|googleusercontent\.com)$/;

const PROXY_HOST = process.env.TUBE_PROXY_HOST || 'localhost';

const localOrigin = () => `http://${PROXY_HOST}:${ports.PROXY}`;
const proxyPrefix = () => `${localOrigin()}/cors-bypass/`;

const flagOverrides = new Map();

const upstream = {
    origin: YOUTUBE_ORIGIN,
    abrThroughService: false,
    onesie: 'auto',
    nativeProxyPatches: true
};

const spoofUserAgent = (text) => {
    const shim = '<script>try{Object.defineProperty(navigator,"userAgent",'
        + `{get:function(){return ${JSON.stringify(DEV_USER_AGENT)};},configurable:true});`
        + '}catch(e){}</script>';

    return text.indexOf('<head>') === -1 ? text : text.replace('<head>', `<head>${shim}`);
};

// Routes SABR's single media URL through the service so no page patch is needed to reach
// googlevideo.
const rerouteAbr = (text) => text.replace(
    /"serverAbrStreamingUrl":"(https:\\?\/\\?\/[^"]+)"/g,
    (whole, url) => `"serverAbrStreamingUrl":"${proxyPrefix()}${url}"`
);

// kabuki and the player both prefix every innertube call with INNERTUBE_HOST_OVERRIDE, which
// brings that traffic here with nothing in the page patched.
const overrideInnertubeHost = (text) => text.replace(
    '"INNERTUBE_CONTEXT_CLIENT_NAME"',
    `"INNERTUBE_HOST_OVERRIDE":${JSON.stringify(localOrigin())},"INNERTUBE_CONTEXT_CLIENT_NAME"`
);

// BotGuard's program URL arrives protocol-relative inside a JSON string, so its quotes and slashes
// may be escaped.
const WRAPPED_PROGRAM = /(\\?"privateDoNotAccessOrElseTrustedResourceUrlWrappedValue\\?"\s*:\s*\\?")((?:\\?\/){2}(?:[^"\\]|\\\/)+)/g;
const PLAIN_PROGRAM = /(\\?"interpreterUrl\\?"\s*:\s*\\?")((?:\\?\/){2}(?:[^"\\]|\\\/)+)/g;

const rewriteAttestation = (text, targetUrl) => {
    const prefix = proxyPrefix();

    const attested = /tv-player-[^/]+\.js/.test(targetUrl) || /player-es6/.test(targetUrl)
        ? text.replace(/https:\/\/jnn-pa\.googleapis\.com/g, `${prefix}https://jnn-pa.googleapis.com`)
        : text;

    return attested
        .replace(WRAPPED_PROGRAM, (whole, lead, url) => `${lead}${prefix}https:${url}`)
        .replace(PLAIN_PROGRAM, (whole, lead, url) => `${lead}${prefix}https:${url}`);
};

const BLOB = /(serializedExperimentFlags\\?":\\?")((?:[^"\\]|\\u[0-9a-fA-F]{4})*)/g;

const retuneFlag = (blob, [name, value]) => {
    const flag = new RegExp(`(^|\\\\u0026|&)${name}(\\\\u003d|=)[^\\\\&]*`);

    if (flag.test(blob)) {
        return blob.replace(flag, (whole, separator, equals) => `${separator}${name}${equals}${value}`);
    }

    // An absent flag reads as off, so turning one on means adding it to the front of the blob.
    return `${name}\\u003d${value}\\u0026${blob}`;
};

const retuneFlags = (text) => text.replace(BLOB, (whole, lead, blob) => (
    `${lead}${Array.from(flagOverrides).reduce(retuneFlag, blob)}`
));

const rewriteBody = (text, url) => {
    if (url.indexOf('/tv') !== 0 || url.indexOf('/tv_config') !== -1) return text;

    const tuned = [
        DEV_USER_AGENT ? spoofUserAgent : null,
        flagOverrides.size ? retuneFlags : null,
        upstream.nativeProxyPatches ? null : overrideInnertubeHost
    ].filter(Boolean).reduce((out, step) => step(out), text);

    const origin = localOrigin();

    const tag = `<script>window.__TUBE_NATIVE_PROXY_PATCHES__=${upstream.nativeProxyPatches};</script>`
        + `<script src="${origin}/__tube/userScript.js?v=${Date.now()}"></script>`
        + (DEV_INJECT_PATH ? `<script src="${origin}/__tube/dev.js?v=${Date.now()}"></script>` : '');

    // Appended past </html> a browser still runs it; Cobalt's parser drops it.
    return tuned.indexOf('</body>') !== -1 ? tuned.replace('</body>', `${tag}</body>`) : tuned + tag;
};

// __Secure- / __Host- prefixed cookies are rejected over plain HTTP, so they are renamed in both
// directions and the HTTPS-only attributes dropped.
const rewriteSetCookie = (values) => values.map((cookie) => cookie
    .replace(/^__Secure-/i, '__LocalSecure-')
    .replace(/^__Host-/i, '__LocalHost-')
    .replace(/Domain=[^;]+/i, 'Domain=localhost')
    .replace(/;\s*Secure/i, '')
    .replace(/;\s*SameSite=None/i, '')
    .replace(/;\s*;/g, ';')
    .replace(/;\s*$/, ''));

const restoreCookiePrefixes = (header) => header
    .replace(/__LocalSecure-/g, '__Secure-')
    .replace(/__LocalHost-/g, '__Host-');

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
        if (!journal.wanted()) return next();

        const path = String(req.url || req.originalUrl);

        // Our own /__tube/ requests would drown the page's in the journal.
        if (path.indexOf('/__tube/') !== 0) journal.service('asked', `${req.method} ${path.slice(0, 150)}`);

        return next();
    });

    app.use((req, res, next) => {
        allowOrigin(req, res);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
        res.setHeader('Access-Control-Allow-Headers', req.get('access-control-request-headers') || '*');

        if (req.method === 'OPTIONS') return res.status(200).end();
        return next();
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

    if (DEV_INJECT_PATH) {
        app.get('/__tube/dev.js', (_, res) => {
            try {
                res.type('application/javascript').send(readFileSync(DEV_INJECT_PATH, 'utf8'));
            } catch (e) {
                res.status(500).type('application/javascript')
                    .send(`console.error(${JSON.stringify(`tube: could not read ${DEV_INJECT_PATH} - ${e.message}`)});`);
            }
        });
    }

    return app;
};

const routeFor = (req) => {
    const bypassTarget = () => {
        const raw = req.url.substring('/cors-bypass/'.length);
        return raw.indexOf('http') === 0 ? raw : `https://${raw}`;
    };

    const targetOf = (isBypass) => (
        isBypass ? bypassTarget() : `${YOUTUBE_ORIGIN}${req.url}`
    );

    const hostNamedBy = (target) => {
        try { return URL.parse(target).host || YOUTUBE_HOST; } catch (e) { return YOUTUBE_HOST; }
    };

    // The page is plain HTTP, so Google URLs it builds may carry http: and are upgraded here.
    const upgradeScheme = (target, forGoogle) => (
        forGoogle && target.indexOf('http://') === 0 ? `https://${target.slice(7)}` : target
    );

    const isBypass = req.path.indexOf('/cors-bypass/') === 0;

    const target = targetOf(isBypass);
    const host = hostNamedBy(target);
    const forGoogle = GOOGLE.test(host.split(':')[0]);

    return {
        url: upgradeScheme(target, forGoogle),
        host,
        forGoogle,
        isBypass
    };
};

const headersFor = (req, route) => {
    const dropped = route.forGoogle && upstream.origin === 'drop'
        ? ['proxy-connection', 'origin', 'referer']
        : ['proxy-connection'];

    const referer = req.headers.referer ? { referer: `${upstream.origin}/tv` } : {};
    const presented = route.forGoogle && upstream.origin !== 'drop' && upstream.origin !== 'pass'
        ? Object.assign({ origin: upstream.origin }, referer)
        : {};

    const copied = Object.keys(req.headers)
        .filter((key) => dropped.indexOf(key) === -1)
        // The page carries renamed cookies, because we served it on plain HTTP.
        .map((key) => [key, key === 'cookie' ? restoreCookiePrefixes(req.headers[key]) : req.headers[key]]);

    return Object.assign({}, Object.fromEntries(copied), { host: route.host }, presented,
        DEV_USER_AGENT ? { 'user-agent': DEV_USER_AGENT } : {},
        // Brotli is not decoded here, so ask for encodings that can be read.
        { 'accept-encoding': 'gzip, deflate' });
};

const isRetriable = (error) => !!error
    && (RETRIABLE.indexOf(error.code) !== -1 || /socket hang up|premature close/i.test(error.message || ''));

const send = (url, req, headers) => {
    const body = BODIED.indexOf(req.method) === -1 ? undefined : req;

    const options = {
        method: req.method,
        headers,
        body,
        redirect: 'manual',
        agent: agentFor(url)
    };

    return fetch(url, options).catch((error) => {
        // A streamed body cannot be sent twice.
        if (!isRetriable(error) || body) throw error;

        postmortem.note('upstream', `${postmortem.describe(error)} on ${url.slice(0, 80)}`
            + ' — retrying on a fresh connection');

        return fetch(url, Object.assign({}, options, { agent: undefined }));
    });
};

const copyHeaders = (req, res, response, route) => {
    const raw = response.headers.raw();

    Object.keys(raw).forEach((key) => {
        const lower = key.toLowerCase();

        if (STRIPPED_HEADERS.indexOf(lower) !== -1) return;
        if (route.isBypass && lower === 'access-control-allow-origin') return;

        if (lower === 'set-cookie' && Array.isArray(raw[key])) {
            res.setHeader('Set-Cookie', rewriteSetCookie(raw[key]));
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
            journal.service('onesie', `refused ${req.method}`);
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
            journal.service('failed', `${what} ${route.url.slice(0, 110)}`);

            if (res.headersSent) return res.destroy();
            return res.status(500).type('text/plain').send(`tube: ${what}`);
        };

        return send(route.url, req, headers)
            .then((response) => {
                res.status(response.status);

                if (route.isBypass) journal.service('answered', `${response.status} ${route.url.slice(0, 110)}`);

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
                    const injected = rewriteAttestation(rewriteBody(text, req.url), route.url);

                    const abr = upstream.abrThroughService && route.url.indexOf('/youtubei/v1/player') !== -1;

                    res.send(abr ? rerouteAbr(injected) : injected);
                });
            })
            .catch((error) => fail('upstream failed', error));
    });

    return app;
};

module.exports = {
    create, attachFallback, rewriteBody, rewriteAttestation,
    rewriteSetCookie, restoreCookiePrefixes, flagOverrides, upstream
};
