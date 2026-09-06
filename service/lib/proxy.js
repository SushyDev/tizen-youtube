'use strict';

// The proxy the app is served through. youtube.com comes back from here so the userscript can be
// injected with a plain script tag, and so requests Google will not answer to our origin can be
// carried for the page.

const express = require('express');
const fetch = require('node-fetch');
const http = require('http');
const https = require('https');
const os = require('os');
const URL = require('url');
const { readFileSync } = require('fs');

const ports = require('./ports.js');
const loader = require('./loader.js');
const forward = require('./forward.js');
const journal = require('./journal.js');
const postmortem = require('./postmortem.js');
const bigheaders = require('./bigheaders.js');

// No socket timeout. A SABR answer is one long-lived response the player reads from for as long
// as it is watching, so a timeout here is a hard cap on how long a video plays.
const AGENT_OPTIONS = { keepAlive: true, keepAliveMsecs: 15000, maxSockets: 8, timeout: 0 };
const httpsAgent = new https.Agent(AGENT_OPTIONS);
const httpAgent = new http.Agent(AGENT_OPTIONS);
const agentFor = (url) => (String(url).indexOf('https:') === 0 ? httpsAgent : httpAgent);

const DEV_USER_AGENT = process.env.TUBE_DEV_UA || '';
const DEV_INJECT_PATH = process.env.TUBE_DEV_INJECT || '';

const TEXTUAL = ['text/html', 'application/json', 'javascript', 'text/css'];
const STRIPPED_HEADERS = ['content-encoding', 'content-length', 'transfer-encoding', 'alt-svc'];
const CSP_HEADER = 'content-security-policy';
const BODIED = ['POST', 'PUT', 'PATCH'];

// A dead pooled socket is handed out anyway and the request dies on it; newer Node retries that
// internally, Node 12 does not. Every one of those became a 500, which the container answers by
// retrying for ever behind a network error.
const RETRIABLE = ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECONNREFUSED'];

const GOOGLE = /(^|\.)(youtube\.com|googlevideo\.com|googleapis\.com|google\.com|ggpht\.com|gstatic\.com)(:|$)/;

// How many intercepted requests to write to the log on disk before falling quiet: inside the
// container there is no console and no dev bridge, and a working page makes hundreds.
const TRACE_LIMIT = 40;

const state = { host: process.env.TUBE_PROXY_HOST || null, traced: 0 };

// The container is a different package and cannot reach our loopback, so every URL handed to it
// has to name the set on the network. Resolved lazily: the service can start before the set has
// an address.
const onTheNetwork = () => {
    const interfaces = os.networkInterfaces();

    const found = Object.keys(interfaces)
        .reduce((all, device) => all.concat(interfaces[device]), [])
        .find((face) => face && face.family === 'IPv4' && !face.internal);

    return found ? found.address : null;
};

const proxyHost = () => {
    if (!state.host) state.host = onTheNetwork();
    return state.host || 'localhost';
};

const localOrigin = () => `http://${proxyHost()}:${ports.PROXY}`;
const proxyPrefix = () => `${localOrigin()}/cors-bypass/`;

const interceptedTls = (req) => !!(req.socket && (req.socket.__tubeMitm || req.socket.encrypted));

// Which experiment flags the page is served with, and which Origin the service presents to
// Google. Both settable at runtime through /__tube/dev so an A/B does not cost a reinstall.
const flagOverrides = new Map();

const upstream = {
    origin: 'https://www.youtube.com',
    abrThroughService: false,
    onesie: 'auto',
    nativeProxyPatches: true
};

// -- rewrites ------------------------------------------------------------------------------------

const nonceOf = (policy) => (/'nonce-([A-Za-z0-9+/_-]+)'/.exec(policy || '') || [])[1] || null;

const spoofUserAgent = (text) => {
    const shim = '<script>try{Object.defineProperty(navigator,"userAgent",'
        + `{get:function(){return ${JSON.stringify(DEV_USER_AGENT)};},configurable:true});`
        + '}catch(e){}</script>';

    // No <head> means an unexpected shape; leaving it alone beats guessing.
    return text.indexOf('<head>') === -1 ? text : text.replace('<head>', `<head>${shim}`);
};

// Onesie delivers the player response encrypted inside the media stream, so with it on there is
// no JSON to read. The html5_onesie flag does not stop it — the client uses onesie whenever the
// page hands it a hot config, so the way to turn it off is to take that away.
const withoutOnesie = (text) => text.replace(/"onesieHotConfig"/g, '"onesieHotConfigWithheld"');

// With SABR there is one media URL in the player response and every byte comes from it. Sending
// that one field through the service means the page needs no patched fetch to reach googlevideo.
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

// BotGuard's program URL comes from /tv_config, wrapped in a TrustedResourceUrl, protocol-relative
// and inside a JSON string — so its quotes and slashes arrive escaped. A pattern expecting a bare
// quote matches nothing and fails silently, which cost three rounds of guessing.
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

// In the page the blob is a JSON string, so its separators arrive escaped. Matching only the
// plain form silently does nothing, which looks exactly like it working.
const BLOB = /serializedExperimentFlags\\?":\\?"/;

const retuneFlags = (text) => Array.from(flagOverrides).reduce((out, [name, value]) => {
    const escaped = new RegExp(`${name}\\\\u003d[^\\\\"]*`, 'g');
    const plain = new RegExp(`${name}=[^&"\\\\]*`, 'g');

    if (escaped.test(out)) return out.replace(escaped, `${name}\\u003d${value}`);
    if (plain.test(out)) return out.replace(plain, `${name}=${value}`);

    // An absent flag reads as off, so turning one on means adding it to the front of the blob.
    const found = BLOB.exec(out);
    if (!found) return out;

    const insert = found.index + found[0].length;
    return `${out.slice(0, insert)}${name}\\u003d${value}\\u0026${out.slice(insert)}`;
}, text);

const rewriteBody = (text, url, injectionOrigin, nonce) => {
    if (url.indexOf('/tv') !== 0 || url.indexOf('/tv_config') !== -1) return text;

    const tuned = [
        DEV_USER_AGENT ? spoofUserAgent : null,
        flagOverrides.size ? retuneFlags : null,
        upstream.onesie === 'off' ? withoutOnesie : null,
        upstream.nativeProxyPatches ? null : overrideInnertubeHost
    ].filter(Boolean).reduce((out, step) => step(out), text);

    // Only our own script: googlevideo and jnn-pa allow our origin, so the player reaches them
    // itself. The nonce is quoted from the page's own script-src — without it the injected tags
    // are refused by the nonce policy YouTube serves a Cobalt client.
    const stamp = nonce ? ` nonce="${nonce}"` : '';
    const origin = injectionOrigin || localOrigin();

    const tag = `<script${stamp}>window.__TUBE_NATIVE_PROXY_PATCHES__=${upstream.nativeProxyPatches};</script>`
        + `<script${stamp} src="${origin}/__tube/userScript.js?v=${Date.now()}"></script>`
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

// -- the application -----------------------------------------------------------------------------

// Express matches routes in registration order and the fallback matches everything, so it must be
// attached after the caller's own routes.
const create = () => {
    const app = express();

    // When --proxy names the service itself, put the absolute request line back to a path so the
    // routes below see what they expect.
    app.use((req, _, next) => {
        forward.normaliseSelf(req, proxyHost(), ports.PROXY);
        next();
    });

    app.use((req, _, next) => {
        const watching = journal.wanted();
        const tracing = state.traced < TRACE_LIMIT;
        if (!watching && !tracing) return next();

        // req.url, not originalUrl: the forward-proxy form has already been put back to a path.
        const path = String(req.url || req.originalUrl);
        const ours = path.indexOf('/__tube/') === 0;
        const intercepted = interceptedTls(req);

        // Our own chatter would drown the page's: the dev bridge alone polls five times a second.
        if (watching && !ours) journal.service('asked', `${req.method} ${path.slice(0, 150)}`);

        if (watching && intercepted) {
            journal.service('mitmreq', `${req.method} ${path.slice(0, 150)} host=${req.headers.host || '?'}`);
        }

        if (tracing && intercepted && !ours) {
            state.traced += 1;
            postmortem.note('req', `${req.method} ${req.headers.host || '?'}${path.slice(0, 120)}`);
        }

        return next();
    });

    app.use((req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
        res.setHeader('Access-Control-Allow-Headers', '*');

        if (req.method === 'OPTIONS') return res.status(200).end();
        return next();
    });

    // Served from the package or the verified cache, never from a CDN.
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

// Where a request is really going, and how the answer has to be dressed to be usable.
const routeFor = (req) => {
    const forwarded = forward.absoluteTarget(req.url);
    const isBypass = !forwarded && req.path.indexOf('/cors-bypass/') === 0;
    const intercepted = interceptedTls(req);

    const target = (() => {
        if (forwarded) return forwarded;

        if (isBypass) {
            const raw = req.url.substring('/cors-bypass/'.length);
            return raw.indexOf('http') === 0 ? raw : `https://${raw}`;
        }

        if (intercepted && req.path.indexOf('/__tube/') === 0) return `${localOrigin()}${req.url}`;
        if (intercepted && req.headers.host) return `https://${req.headers.host}${req.url}`;

        return `https://www.youtube.com${req.url}`;
    })();

    const host = (() => {
        try { return URL.parse(target).host || 'www.youtube.com'; } catch (e) { return 'www.youtube.com'; }
    })();
    const forGoogle = GOOGLE.test(host.split(':')[0]);

    // Google answers over TLS whatever the request line said; the plain scheme only exists so the
    // request reaches us in the first place.
    const url = forGoogle && target.indexOf('http://') === 0 ? `https://${target.slice(7)}` : target;

    // Whether the answer goes back as youtube.com over our own TLS rather than as the service on
    // plain HTTP. Cookies and the injection origin both depend on it.
    return { url, host, forGoogle, isBypass, asOurselves: intercepted };
};

const headersFor = (req, route) => {
    // Copied in place rather than rebuilt per key: this runs on every request the set makes.
    const headers = Object.keys(req.headers).reduce((all, key) => {
        if (key === 'proxy-connection') return all;

        // The page only carries renamed cookies when we served it as the service on plain HTTP.
        all[key] = key === 'cookie' && !route.asOurselves
            ? restoreCookiePrefixes(req.headers[key])
            : req.headers[key];

        return all;
    }, {});

    headers.host = route.host;

    // The proof-of-origin token is minted at our origin, so if the server cross-checks the two
    // this is the input that decides it.
    if (route.forGoogle && upstream.origin === 'drop') {
        delete headers.origin;
        delete headers.referer;
    } else if (route.forGoogle && upstream.origin !== 'pass') {
        headers.origin = upstream.origin;
        if (headers.referer) headers.referer = `${upstream.origin}/tv`;
    }

    if (DEV_USER_AGENT) headers['user-agent'] = DEV_USER_AGENT;

    // Brotli is not decoded here, so ask for encodings that can be read.
    headers['accept-encoding'] = 'gzip, deflate';

    return headers;
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
        // YouTube's header block is larger than Node's HTTP/1 parser will accept and the limit
        // cannot be raised from in here, so the same request goes again over HTTP/2.
        if (bigheaders.isHeaderOverflow(error) && !body && url.indexOf('https:') === 0) {
            postmortem.note('upstream', `header overflow on ${url.slice(0, 80)} — retrying over http2`);
            return bigheaders.fetchOverHttp2(url, { method: req.method, headers });
        }

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
        // YouTube's own policy names Cobalt's grammar for reaching a private address; a generic
        // permissive one throws those grants away. It is kept when we answer as youtube.com.
        if (lower === CSP_HEADER && !route.asOurselves) return;
        if (route.isBypass && lower === 'access-control-allow-origin') return;

        // Over the MITM the page's origin really is https://www.youtube.com, and rewriting cookies
        // there scopes every one to a domain the page is not on: the client drops the lot and
        // refetches the page for ever behind a network error.
        if (lower === 'set-cookie' && Array.isArray(raw[key])) {
            res.setHeader('Set-Cookie', route.asOurselves ? raw[key] : rewriteSetCookie(raw[key]));
            return;
        }

        res.setHeader(key, response.headers.get(key));
    });

    // A wildcard is refused for a request that carries cookies, so when the page names itself the
    // answer names it back.
    const asked = req.get('origin');
    res.setHeader('Access-Control-Allow-Origin', asked || '*');
    if (asked) res.setHeader('Access-Control-Allow-Credentials', 'true');

    // A redirect is followed by the browser underneath anything the page has hooked, so an
    // untouched Location leaves our origin and dies on CORS. SABR moves between googlevideo hosts
    // constantly, so the hop has to come back through here.
    const movedTo = response.status >= 300 && response.status < 400 && response.headers.get('location');
    if (route.isBypass && movedTo && /^https?:\/\//.test(movedTo)) {
        res.setHeader('Location', proxyPrefix() + movedTo);
    }
};

// Must be called after every other route is registered.
const attachFallback = (app) => {
    app.all('*', (req, res) => {
        // Refusing the onesie request is the way to get a plain player response out of the client:
        // withholding its hot config stalls it, but a failed request is a case it already handles.
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
                res.status(req.method === 'OPTIONS' ? 200 : response.status);

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
                    const injectionOrigin = route.asOurselves && req.headers.host
                        ? `https://${req.headers.host}`
                        : null;
                    const nonce = route.asOurselves ? nonceOf(response.headers.get(CSP_HEADER)) : null;

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

module.exports = {
    create, attachFallback, rewriteBody, rewriteAttestation, rerouteAbr, withoutOnesie,
    overrideInnertubeHost, rewriteSetCookie, restoreCookiePrefixes,
    flagOverrides, upstream
};
