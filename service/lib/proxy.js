"use strict";

// MITM proxy: the fallback when Developer Mode is off. youtube.com is proxied through
// localhost so the userscript can be injected with a plain script tag and CSP never
// applies. The rewrite table is ported unchanged from the reference — it is empirically
// derived and every rule is load bearing.

const express = require('express');
const fetch = require('node-fetch');
const http = require('http');
const https = require('https');
const URL = require('url');
const { readFileSync } = require('fs');

const journal = require('./journal.js');
// TEMPORARY, for the Cobalt attestation investigation.
const exchange = require('./exchange.js');

// Without an agent node-fetch reconnects per request, so every segment of a 4K stream
// paid for a TLS handshake on the set's own processor while it was decoding.
// No socket timeout. A SABR answer is a single long-lived response that the player reads from for
// as long as it is watching, so any timeout here is a hard cap on how long a video plays: at sixty
// seconds the socket was closed, the buffer drained to exactly that, and the player was torn down.
const AGENT_OPTIONS = { keepAlive: true, keepAliveMsecs: 15000, maxSockets: 8, timeout: 0 };
const httpsAgent = new https.Agent(AGENT_OPTIONS);
const httpAgent = new http.Agent(AGENT_OPTIONS);
const agentFor = (url) => (String(url).indexOf('https:') === 0 ? httpsAgent : httpAgent);

const ports = require('./ports.js');
const loader = require('./loader.js');
const forward = require('./forward.js');
const postmortem = require('./postmortem.js');
const bigheaders = require('./bigheaders.js');

// How many intercepted requests to write to the log before falling quiet.
const TRACE_LIMIT = 40;
let traced = 0;

// The set reaches the service on loopback. TUBE_PROXY_HOST points it at another machine
// instead, which is how the proxy's cost can be taken off the television entirely.
// TEMPORARY, for the Cobalt container experiment: the container is a different package and cannot
// reach our loopback, so every URL it is handed has to name the television on the network.
const onTheNetwork = () => {
    const found = Object.values(require('os').networkInterfaces()).flat()
        .filter((face) => face && face.family === 'IPv4' && !face.internal);
    return found.length ? found[0].address : null;
};

const PROXY_HOST = process.env.TUBE_PROXY_HOST || onTheNetwork() || 'localhost';
const PROXY_PREFIX = `http://${PROXY_HOST}:${ports.PROXY}/cors-bypass/`;
const LOCAL_ORIGIN = `http://${PROXY_HOST}:${ports.PROXY}`;

const DEV_USER_AGENT = process.env.TUBE_DEV_UA || '';

const DEV_INJECT_PATH = process.env.TUBE_DEV_INJECT || '';

const TEXTUAL = ['text/html', 'application/json', 'javascript', 'text/css'];

// Hop-by-hop and security headers. Dropping the CSP is what lets the script run.
const STRIPPED_HEADERS = ['content-encoding', 'content-length', 'transfer-encoding', 'alt-svc'];

// YouTube's own policy is kept when we are answering as youtube.com, and dropped when we are
// answering as the service on plain HTTP. It says `default-src 'none'` and then names what the app
// may reach, including two source expressions that are Cobalt's own grammar --
// 'cobalt-insecure-private-range' and 'cobalt-insecure-local-network' -- for permitting plain HTTP
// to a private address. A generic permissive policy cannot express those, so substituting one
// throws away the very grants the client needs and every resource is denied: a black screen behind
// a loaded page. Its script-src carries a nonce, which the injected tag has to quote to be allowed.
const CSP_HEADER = 'content-security-policy';

const nonceOf = (policy) => (/'nonce-([A-Za-z0-9+/_-]+)'/.exec(policy || '') || [])[1] || null;

// First thing in the head: the client reads the user agent in its very first script.
function spoofUserAgent(text) {
    const shim = '<script>try{Object.defineProperty(navigator,"userAgent",' +
        `{get:function(){return ${JSON.stringify(DEV_USER_AGENT)};},configurable:true});` +
        '}catch(e){}</script>';

    // No <head> means an unexpected shape; leaving it alone beats guessing.
    return text.indexOf('<head>') === -1 ? text : text.replace('<head>', `<head>${shim}`);
}

// The container's player reads its own configuration out of `serializedExperimentFlags` in the
// page. Setting one here changes which delivery path the player asks for — the whole reason this
// exists is to be able to move it off SABR and onto the ordinary adaptive formats, which are
// plain ranged GETs with no UMP framing. Set at runtime through /__tube/dev/flags so an A/B does
// not cost a reinstall; empty means the page is passed through untouched.
const flagOverrides = new Map();

// 'https://www.youtube.com' (the default), 'pass' to forward the page's own, or 'drop' for none.
// Media hosts only: pointing innertube at a foreign origin breaks SAPISIDHASH and signs the
// account out, which is not obvious until it happens.
const upstream = {
    origin: 'https://www.youtube.com',
    abrThroughService: false,
    onesie: 'auto',
    nativeProxyPatches: true
};

// Onesie delivers the player response encrypted inside the media stream, so with it on there is no
// JSON for the service to read or rewrite. The html5_onesie flag does not stop it — the client uses
// onesie whenever the page hands it a hot config, so the way to turn it off is to take that away.
function withoutOnesie(text) {
    return text.replace(/"onesieHotConfig"/g, '"onesieHotConfigWithheld"');
}

// With SABR there is exactly one media URL in the player response and every byte comes from it.
// Sending that one field through the service means the page needs no patched fetch to reach
// googlevideo — the only way to run the client with the platform genuinely untouched.
function rerouteAbr(text) {
    return text.replace(
        /"serverAbrStreamingUrl":"(https:\\?\/\\?\/[^"]+)"/g,
        (whole, url) => `"serverAbrStreamingUrl":"${PROXY_PREFIX}${url}"`
    );
}

function proxyGoogleUrl(url) {
    return `${PROXY_PREFIX}${url}`;
}

// With the native patches off nothing rewrites an absolute https://www.youtube.com/… URL, so those
// requests leave over Cobalt's --proxy tunnel where the service cannot read them — which is why the
// attestation challenge arrived unrewritten. The client has its own knob for this: kabuki and the
// player both read INNERTUBE_HOST_OVERRIDE and prefix every innertube call with it, so setting it
// brings that traffic here with nothing in the page patched.
function overrideInnertubeHost(text) {
    return text.replace(
        '"INNERTUBE_CONTEXT_CLIENT_NAME"',
        `"INNERTUBE_HOST_OVERRIDE":${JSON.stringify(LOCAL_ORIGIN)},"INNERTUBE_CONTEXT_CLIENT_NAME"`
    );
}

// TEMPORARY: the BotGuard program URL has been missed twice by guessing at its shape. This says
// which response carries it and what it actually looks like on the wire.
function noteAttestationShape(text, targetUrl, contentType) {
    if (!journal.wanted()) return;

    const at = text.indexOf('interpreterUrl');
    if (at === -1) return;

    journal.service('bgchallenge', `${targetUrl.slice(0, 70)} [${contentType}] ${text.slice(at, at + 140)}`);
}

function rewriteAttestation(text, targetUrl) {
    if (/tv-player-[^/]+\.js/.test(targetUrl) || /player-es6/.test(targetUrl)) {
        text = text.replace(/https:\/\/jnn-pa\.googleapis\.com/g,
            proxyGoogleUrl('https://jnn-pa.googleapis.com'));
    }

    // BotGuard's program URL. It took three wrong guesses to pin down, so for the record: it is not
    // in /att/get (this client never calls it), it is not in the page, and it does not ride in
    // browse/next/player. It comes from /tv_config, wrapped in a TrustedResourceUrl, protocol-
    // relative, and inside a JSON string — so the quotes around it arrive escaped:
    //
    //   interpreterUrl\":{\"privateDoNotAccessOrElse…WrappedValue\":\"//www.google.com/js/th/….js
    //
    // Any pattern expecting a bare " matches nothing at all and fails silently. Both quotings are
    // allowed for here. Getting this right is what lets the script reach us without patching
    // HTMLScriptElement.src in the page.
    // The slashes may be escaped as well as the quotes, so the URL is matched as "// or \/\/
    // followed by anything that is not an unescaped quote".
    const WRAPPED = /(\\?"privateDoNotAccessOrElseTrustedResourceUrlWrappedValue\\?"\s*:\s*\\?")((?:\\?\/){2}(?:[^"\\]|\\\/)+)/g;
    const PLAIN = /(\\?"interpreterUrl\\?"\s*:\s*\\?")((?:\\?\/){2}(?:[^"\\]|\\\/)+)/g;

    text = text.replace(WRAPPED, (whole, prefix, url) => `${prefix}${PROXY_PREFIX}https:${url}`);
    text = text.replace(PLAIN, (whole, prefix, url) => `${prefix}${PROXY_PREFIX}https:${url}`);

    return text;
}

// In the page the blob is a JSON string, so its separators arrive escaped: `=` as = and `&`
// as &. Matching the plain form alone silently does nothing, which is worth a comment because
// it looks like it is working.
// Tolerant of both, because the page carries it plain and a nested JSON payload would escape it.
const BLOB = /serializedExperimentFlags\\?":\\?"/;

function retuneFlags(text) {
    let out = text;

    for (const [name, value] of flagOverrides) {
        const escaped = new RegExp(`${name}\\\\u003d[^\\\\"]*`, 'g');
        const plain = new RegExp(`${name}=[^&"\\\\]*`, 'g');

        if (escaped.test(out)) {
            out = out.replace(escaped, `${name}\\u003d${value}`);
        } else if (plain.test(out)) {
            out = out.replace(plain, `${name}=${value}`);
        } else {
            // Not every flag the player reads is one the server sent. An absent flag reads as off,
            // so turning one on means adding it to the front of the blob.
            const found = BLOB.exec(out);
            if (found) {
                const insert = found.index + found[0].length;
                out = `${out.slice(0, insert)}${name}\\u003d${value}\\u0026${out.slice(insert)}`;
            }
        }
    }

    return out;
}

function rewriteBody(text, url, injectionOrigin, nonce) {
    if (url.indexOf('/tv') === 0 && url.indexOf('/tv_config') === -1) {
        if (DEV_USER_AGENT) text = spoofUserAgent(text);
        if (flagOverrides.size) text = retuneFlags(text);
        if (upstream.onesie === 'off') text = withoutOnesie(text);
        if (!upstream.nativeProxyPatches) text = overrideInnertubeHost(text);
        // Only our own script. Nothing of the platform is patched: googlevideo and jnn-pa allow
        // our origin, so the player reaches them itself, exactly as the stock app does.
        // Quoted from the page's own script-src when there is one. Without it the injected tags
        // are refused by a nonce-based policy, which is what YouTube serves a Cobalt client.
        const stamp = nonce ? ` nonce="${nonce}"` : '';
        const setting = `<script${stamp}>window.__TUBE_NATIVE_PROXY_PATCHES__=`
            + `${upstream.nativeProxyPatches};</script>`;
        const origin = injectionOrigin || LOCAL_ORIGIN;
        const tag = `${setting}<script${stamp} src="${origin}/__tube/userScript.js?v=${Date.now()}"></script>`;

        // Appended past </html> a browser still runs it; Cobalt's parser drops it. Inside the
        // document, last thing before </body>, keeps the timing and works in both.
        if (text.indexOf('</body>') !== -1) text = text.replace('</body>', `${tag}</body>`);
        else text += tag;
        if (DEV_INJECT_PATH) text += `<script src="${origin}/__tube/dev.js?v=${Date.now()}"></script>`;
    }

    return text;
}

// __Secure- / __Host- prefixed cookies are rejected over plain HTTP, so they are renamed
// in both directions and the HTTPS-only attributes dropped.
function rewriteSetCookie(values) {
    return values.map((cookie) =>
        cookie
            .replace(/^__Secure-/i, '__LocalSecure-')
            .replace(/^__Host-/i, '__LocalHost-')
            .replace(/Domain=[^;]+/i, 'Domain=localhost')
            .replace(/;\s*Secure/i, '')
            .replace(/;\s*SameSite=None/i, '')
            .replace(/;\s*;/g, ';')
            .replace(/;\s*$/, '')
    );
}

function restoreCookiePrefixes(cookieHeader) {
    return cookieHeader
        .replace(/__LocalSecure-/g, '__Secure-')
        .replace(/__LocalHost-/g, '__Host-');
}

// Express matches routes in registration order and this catch-all matches everything, so
// it must be attached after the caller's own routes — otherwise /__tube/state gets
// YouTube's HTML instead of JSON and the app never launches.
function create(platformVersion) {
    const app = express();

    // Cobalt reaches the service two ways: as an ordinary origin, and — when it is started with
    // --proxy — as a forward proxy, which names the whole URL on the request line. When that URL
    // is the service itself, put it back to a path so the routes below see what they expect.
    app.use((req, _, next) => {
        forward.normaliseSelf(req, PROXY_HOST, ports.PROXY);
        next();
    });

    // Only while diagnostics are open, and worth its keep: a page that has stopped asking for
    // anything looks exactly like one that is asking and being refused, and the difference is
    // most of the diagnosis.
    app.use((req, _, next) => {
        // req.url, not originalUrl: the forward-proxy form has already been put back to a path
        // above, and originalUrl still holds the absolute URI the request line carried.
        const path = String(req.url || req.originalUrl);

        // Our own chatter would drown the page's: the dev bridge alone polls five times a second.
        if (journal.wanted() && path.indexOf('/__tube/') !== 0) {
            journal.service('asked', `${req.method} ${path.slice(0, 150)}`);
        }
        if (journal.wanted() && req.socket && (req.socket.__tubeMitm || req.socket.encrypted)) {
            journal.service('mitmreq', `${req.method} ${path.slice(0, 150)} host=${req.headers.host || '?'}`);
        }

        // The first handful of intercepted requests, into the log on disk. Inside the container
        // there is no console and no dev bridge, and `mitm:` says only that a host was reached
        // once — so when a page arrives and then nothing happens, this is the only way to see how
        // far it got. Capped, because a working page makes hundreds and the log rolls at 64KB.
        if (traced < TRACE_LIMIT && req.socket && (req.socket.__tubeMitm || req.socket.encrypted)
            && path.indexOf('/__tube/') !== 0) {
            traced += 1;
            postmortem.note('req', `${req.method} ${req.headers.host || '?'}${path.slice(0, 120)}`);
        }

        next();
    });

    app.use((req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
        res.setHeader('Access-Control-Allow-Headers', '*');
        if (req.method === 'OPTIONS') return res.status(200).end();
        next();
    });

    // Served from the package or the verified cache, never from a CDN.
    app.get('/__tube/userScript.js', (_, res) => {
        try {
            const script = loader.resolve(platformVersion);
            res.type('application/javascript').send(script.source);
        } catch (e) {
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
}

// Must be called after every other route is registered.
function attachFallback(app) {
    app.all('*', (req, res) => {
        // Refusing the onesie request is the way to get a plain /youtubei/v1/player response out of
        // the client. Withholding its hot config does not work — the client stalls instead of
        // falling back — but a failed request is a case it already handles.
        if (upstream.onesie === 'fail' && req.url.indexOf('initplayback') !== -1) {
            if (journal.wanted()) journal.service('onesie', `refused ${req.method}`);
            return res.status(502).end();
        }

        // Anything still absolute here came from Cobalt's own --proxy and is meant for somewhere
        // else on the network; it goes out untouched.
        const forwarded = forward.absoluteTarget(req.url);
        const isBypass = !forwarded && req.path.indexOf('/cors-bypass/') === 0;

        let targetUrl;
        if (forwarded) {
            targetUrl = forwarded;
        } else if (isBypass) {
            const raw = req.url.substring('/cors-bypass/'.length);
            targetUrl = raw.indexOf('http') === 0 ? raw : `https://${raw}`;
        } else if (req.socket && (req.socket.__tubeMitm || req.socket.encrypted)
            && req.path.indexOf('/__tube/') === 0) {
            targetUrl = `http://${PROXY_HOST}:${ports.PROXY}${req.url}`;
        } else if (req.socket && (req.socket.__tubeMitm || req.socket.encrypted) && req.headers.host) {
            targetUrl = `https://${req.headers.host}${req.url}`;
        } else {
            targetUrl = `https://www.youtube.com${req.url}`;
        }

        // Whether this response is going back as youtube.com over our own TLS, rather than as
        // the service on plain HTTP. Cookies and the injection origin both depend on it.
        const asOurselves = !!(req.socket && (req.socket.__tubeMitm || req.socket.encrypted));

        const headers = {};
        for (const key in req.headers) {
            if (!Object.prototype.hasOwnProperty.call(req.headers, key)) continue;
            if (key === 'proxy-connection') continue;
            // Same in reverse: the page only carries renamed cookies when we served it as
            // localhost, so only then do they need putting back.
            headers[key] = (key === 'cookie' && !asOurselves)
                ? restoreCookiePrefixes(req.headers[key])
                : req.headers[key];
        }

        let host = 'www.youtube.com';
        try {
            host = URL.parse(targetUrl).host;
        } catch (e) { /* keep the default */ }
        headers.host = host;

        // Google answers over TLS whatever the request line said; the plain scheme only exists so
        // the request reaches us in the first place.
        const forGoogle = /(^|\.)(youtube\.com|googlevideo\.com|googleapis\.com|google\.com|ggpht\.com|gstatic\.com)(:|$)/
            .test(String(host).split(':')[0]);
        if (forGoogle && targetUrl.indexOf('http://') === 0) targetUrl = `https://${targetUrl.slice(7)}`;

        // What Origin the request carries upstream. The default presents youtube.com, which is what
        // the page's own code would have sent; `pass` forwards the page's real origin untouched and
        // `drop` sends none. Runtime-settable so the three can be compared without a reinstall —
        // the proof-of-origin token is minted at our origin, so if the server cross-checks the two
        // this is the input that decides it.
        if (forGoogle && upstream.origin !== 'pass') {
            if (upstream.origin === 'drop') {
                delete headers.origin;
                delete headers.referer;
            } else {
                headers.origin = upstream.origin;
                if (headers.referer) headers.referer = `${upstream.origin}/tv`;
            }
        }
        if (DEV_USER_AGENT) headers['user-agent'] = DEV_USER_AGENT;
        // Brotli is not decoded here, so ask for encodings that can be read.
        headers['accept-encoding'] = 'gzip, deflate';

        const hasBody = ['POST', 'PUT', 'PATCH'].indexOf(req.method) !== -1;

        // TEMPORARY: record the exchanges that decide whether media keeps flowing, so the whole
        // session can be read off the set afterwards instead of a build-and-watch cycle per guess.
        const tag = exchange.tagFor(targetUrl);
        let sent = null;

        const body = (tag && hasBody)
            ? new Promise((done) => {
                const parts = [];
                req.on('data', (chunk) => parts.push(chunk));
                req.on('end', () => { sent = Buffer.concat(parts); done(sent); });
            })
            : Promise.resolve(hasBody ? req : undefined);

        // Keep-alive is worth having — a 4K stream would otherwise pay for a TLS handshake per
        // segment — but a pooled socket the far end has already closed is handed out anyway, and
        // the request dies on it. Newer Node retries that case internally; Node 12, which is what
        // an older television runs, does not, so it surfaces as an intermittent ECONNRESET. Every
        // one of those became a 500, and the container answered a 500 for its page by retrying for
        // ever and showing a network error. Retry once, without the pool, and only for the errors
        // that mean a dead socket rather than a real failure.
        const RETRIABLE = ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECONNREFUSED'];

        const retriable = (error) => error && (RETRIABLE.indexOf(error.code) !== -1
            || /socket hang up|premature close/i.test(error.message || ''));

        const send = (options) => fetch(targetUrl, options);

        const attempt = (payload) => {
            const options = {
                method: req.method,
                headers,
                body: payload,
                redirect: 'manual',
                agent: agentFor(targetUrl)
            };

            const streamed = payload && typeof payload.pipe === 'function';

            return send(options).catch((error) => {
                // YouTube's headers are larger than Node's HTTP/1 parser will accept — 16.3KB of
                // them, against a limit of 8KB on an older television and 16KB on a newer one. The
                // limit cannot be raised from in here, so the same request goes again over HTTP/2,
                // where the header block is not the constraint.
                if (bigheaders.isHeaderOverflow(error) && !streamed && targetUrl.indexOf('https:') === 0) {
                    postmortem.note('upstream', `header overflow on ${targetUrl.slice(0, 80)} — retrying over http2`);
                    return bigheaders.fetchOverHttp2(targetUrl, { method: req.method, headers, body: payload });
                }

                // A body that was streamed rather than buffered cannot be sent twice.
                if (!retriable(error) || streamed) throw error;

                postmortem.note('upstream', `${error.code || error.message} on ${targetUrl.slice(0, 80)}`
                    + ' — retrying on a fresh connection');

                return send(Object.assign({}, options, { agent: undefined }));
            });
        };

        body.then(attempt)
            .then((response) => {
                res.status(req.method === 'OPTIONS' ? 200 : response.status);

                if (isBypass && journal.wanted()) {
                    journal.service('answered', `${response.status} ${targetUrl.slice(0, 110)}`);
                }

                const raw = response.headers.raw();
                for (const key in raw) {
                    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;

                    const lower = key.toLowerCase();
                    if (STRIPPED_HEADERS.indexOf(lower) !== -1) continue;
                    if (lower === CSP_HEADER && !asOurselves) continue;
                    if (isBypass && lower === 'access-control-allow-origin') continue;

                    if (lower === 'set-cookie' && Array.isArray(raw[key])) {
                        // Only on the plain-HTTP path. There the page really is served from
                        // http://localhost:8099, so a cookie scoped to youtube.com would never be
                        // sent back and a __Secure- one would be refused outright. Over the MITM
                        // the page's origin *is* https://www.youtube.com, and rewriting them there
                        // scopes every cookie to a domain the page is not on: the client drops the
                        // lot, cannot establish a session, and refetches the page for ever behind a
                        // network error. Pass them through untouched.
                        res.setHeader('Set-Cookie', asOurselves ? raw[key] : rewriteSetCookie(raw[key]));
                        continue;
                    }

                    res.setHeader(key, response.headers.get(key));
                }

                // A wildcard is refused for a request that carries cookies, so when the page names
                // itself the answer names it back.
                const asked = req.get('origin');
                res.setHeader('Access-Control-Allow-Origin', asked || '*');
                if (asked) res.setHeader('Access-Control-Allow-Credentials', 'true');

                // A redirect is followed by the browser itself, underneath anything the page has
                // hooked, so an untouched Location sends it straight to Google from our origin and
                // the request dies on CORS. Media redirects constantly — SABR moves the session
                // between googlevideo hosts — so the hop has to come back through here.
                const movedTo = response.status >= 300 && response.status < 400
                    && response.headers.get('location');

                if (isBypass && movedTo && /^https?:\/\//.test(movedTo)) {
                    res.setHeader('Location', PROXY_PREFIX + movedTo);
                }

                const contentType = response.headers.get('content-type') || '';
                const isTextual = TEXTUAL.some((type) => contentType.indexOf(type) !== -1);

                // TEMPORARY: see above. The head of the answer is kept while the rest streams on.
                const note = (got, size) => exchange.record({
                    tag,
                    method: req.method,
                    url: targetUrl.slice(0, 400),
                    status: response.status,
                    type: contentType,
                    sent: sent ? sent.toString('base64').slice(0, 12000) : null,
                    sentBytes: sent ? sent.length : 0,
                    sentHash: exchange.fingerprint(sent),
                    origin: headers.origin || null,
                    got: got.toString('base64'),
                    gotBytes: size,
                    protection: tag === 'media' ? exchange.protectionStatus(got) : 0
                });

                if (!isTextual) {
                    if (!response.body) {
                        if (tag) note(Buffer.alloc(0), 0);
                        return res.end();
                    }

                    if (tag) exchange.keepHead(response.body, note);

                    return response.body.pipe(res);
                }

                return response.text().then((text) => {
                    noteAttestationShape(text, targetUrl, contentType);
                    const injectionOrigin = req.socket && (req.socket.__tubeMitm || req.socket.encrypted)
                        && req.headers.host
                        ? `https://${req.headers.host}` : null;
                    const nonce = asOurselves ? nonceOf(response.headers.get(CSP_HEADER)) : null;
                    let body = rewriteBody(text, req.url, injectionOrigin, nonce);
                    body = rewriteAttestation(body, targetUrl);
                    if (tag === 'player' && upstream.abrThroughService) body = rerouteAbr(body);
                    if (tag) note(Buffer.from(text.slice(0, exchange.KEEP_BYTES)), text.length);
                    if (tag === 'player') exchange.keepWhole('player', text);
                    res.send(body);
                });
            })
            .catch((error) => {
                console.error(`Proxy error for ${targetUrl}: ${error.message}`);
                postmortem.note('upstream', `${error.code || 'Error'} ${error.message} `
                    + `on ${targetUrl.slice(0, 90)}`);
                if (!res.headersSent) res.status(500).send('Proxy connection broken.');
            });
    });

    return app;
}

module.exports = {
    create, attachFallback, rewriteBody, rewriteAttestation, rerouteAbr, withoutOnesie,
    overrideInnertubeHost, rewriteSetCookie, restoreCookiePrefixes,
    flagOverrides, upstream
};
