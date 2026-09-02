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

const { Transform } = require('stream');

const journal = require('./journal.js');
const media = require('./stream.js');

// What the page's own player is allowed while this app is serving the picture.
//
// It fetches a second copy of every video into a source buffer that keeps none of it, and
// it has to go on fetching: a player that appends nothing decides its pipeline has died
// and reloads the video every fifteen seconds. It does not have to have the line, though —
// at 2160p60 its copy is as large as the one being watched, and the first segment of the
// real stream cannot arrive until they have finished competing for the same connection.
//
// Slowed rather than refused, because a failed fetch is an error the player reacts to and
// a slow one is just a network it adapts to.
const SPARE_BYTES_PER_SECOND = 192 * 1024;

/** Paces a response to roughly that rate, without buffering it. */
function trickle() {
    const started = Date.now();
    let sent = 0;

    return new Transform({
        transform(chunk, encoding, done) {
            sent += chunk.length;

            const owed = (sent / SPARE_BYTES_PER_SECOND) * 1000;
            const waited = Date.now() - started;

            // Capped: a large chunk should slow the stream, not stall it for a minute.
            const delay = Math.max(0, Math.min(owed - waited, 2000));
            if (!delay) return done(null, chunk);

            setTimeout(() => done(null, chunk), delay);
            return undefined;
        }
    });
}

// DEV: on while this is being proven. Becomes a setting once it is.
const ANONYMOUS_PLAYER = process.env.TUBE_SIGNED_IN_PLAYER !== '1';

// Without an agent node-fetch reconnects per request, so every segment of a 4K stream
// paid for a TLS handshake on the set's own processor while it was decoding.
const AGENT_OPTIONS = { keepAlive: true, keepAliveMsecs: 15000, maxSockets: 8, timeout: 60000 };
const httpsAgent = new https.Agent(AGENT_OPTIONS);
const httpAgent = new http.Agent(AGENT_OPTIONS);
const agentFor = (url) => (String(url).indexOf('https:') === 0 ? httpsAgent : httpAgent);

const ports = require('./ports.js');
const loader = require('./loader.js');
const sabr = require('./sabr.js');

// The set reaches the service on loopback. TUBE_PROXY_HOST points it at another machine
// instead, which is how the proxy's cost can be taken off the television entirely.
const PROXY_HOST = process.env.TUBE_PROXY_HOST || 'localhost';
const PROXY_PREFIX = `http://${PROXY_HOST}:${ports.PROXY}/cors-bypass/`;
const LOCAL_ORIGIN = `http://${PROXY_HOST}:${ports.PROXY}`;

// Development only. youtube.com/tv decides from the user agent whether the caller is a
// TV, so the proxy presents as one upstream and tells the page to report the same.
const DEV_USER_AGENT = process.env.TUBE_DEV_UA || '';

// Development only. One more script after the userscript, read from disk per request.
const DEV_INJECT_PATH = process.env.TUBE_DEV_INJECT || '';


// Rewritten as text; everything else is streamed through so video is never buffered.
const TEXTUAL = ['text/html', 'application/json', 'javascript', 'text/css'];

// Hop-by-hop and security headers. Dropping the CSP is what lets the script run.
const STRIPPED_HEADERS = [
    'content-encoding', 'content-length', 'transfer-encoding',
    'content-security-policy', 'alt-svc'
];

// First thing in the head: the client reads the user agent in its very first script.
function spoofUserAgent(text) {
    const shim = '<script>try{Object.defineProperty(navigator,"userAgent",' +
        `{get:function(){return ${JSON.stringify(DEV_USER_AGENT)};},configurable:true});` +
        '}catch(e){}</script>';

    // No <head> means an unexpected shape; leaving it alone beats guessing.
    return text.indexOf('<head>') === -1 ? text : text.replace('<head>', `<head>${shim}`);
}

function rewriteBody(text, url) {
    // The TV app shell only, not every page.
    if (url.indexOf('/tv') === 0 && url.indexOf('/tv_config') === -1) {
        if (DEV_USER_AGENT) text = spoofUserAgent(text);
        text += `<script src="${LOCAL_ORIGIN}/__tube/userScript.js?v=${Date.now()}"></script>`;
        // After the userscript, so it can drive what the userscript installed.
        if (DEV_INJECT_PATH) text += `<script src="${LOCAL_ORIGIN}/__tube/dev.js?v=${Date.now()}"></script>`;
    }

    // Routed through the bypass. Three spellings each, because YouTube emits absolute,
    // escaped and protocol-relative forms.
    text = text.replace(/https:\/\/([a-zA-Z0-9-.]+)\.googlevideo\.com/g, `${PROXY_PREFIX}https://$1.googlevideo.com`);
    text = text.replace(/https:\\\/\\\/([a-zA-Z0-9-.]+)\.googlevideo\.com/g, `http:\\\/\\\/localhost:${ports.PROXY}\\\/cors-bypass\\\/https:\\\/\\\/$1.googlevideo.com`);
    text = text.replace(/"\/\/([a-zA-Z0-9-.]+)\.googlevideo\.com/g, `"${PROXY_PREFIX}https://$1.googlevideo.com`);

    text = text.replace(/https:\/\/www\.gstatic\.com/g, `${PROXY_PREFIX}https://www.gstatic.com`);
    text = text.replace(/http:\/\/www\.gstatic\.com/g, `${PROXY_PREFIX}https://www.gstatic.com`);
    text = text.replace(/"\/\/www\.gstatic\.com/g, `"${PROXY_PREFIX}https://www.gstatic.com`);
    text = text.replace(/\(\/\/www\.gstatic\.com/g, `(${PROXY_PREFIX}https://www.gstatic.com`);

    text = text.replace(/https:\/\/yt3\.ggpht\.com/g, `${PROXY_PREFIX}https://yt3.ggpht.com`);

    text = text.replace(/https:\/\/clients1\.google\.com/g, `${PROXY_PREFIX}https://clients1.google.com`);
    text = text.replace(/http:\/\/clients1\.google\.com/g, `${PROXY_PREFIX}https://clients1.google.com`);
    text = text.replace(/"\/\/clients1\.google\.com/g, `"${PROXY_PREFIX}https://clients1.google.com`);

    // Without localhost in YouTube's postMessage allowlist, sign-in is dropped.
    text = text.replace('Set(["www.youtube.com","accounts.google.com"]);', 'Set(["www.youtube.com", "accounts.google.com", "localhost"]);');

    // Telemetry and player code compare the embedded page URL against the real origin.
    text = text.replace(/:document\.location\.toString\(\)/g, `:document.location.toString().replace("${LOCAL_ORIGIN}", "https://www.youtube.com")`);
    text = text.replace(/euri:[^,]+,/g, `euri:document.location.toString().replace("${LOCAL_ORIGIN}", "https://www.youtube.com"),`);

    text = text.replace(/https:\/\/s\.youtube\.com/g, `${PROXY_PREFIX}https://s.youtube.com`);
    text = text.replace(/redirector.googlevideo.com/g, `${PROXY_PREFIX}https://redirector.googlevideo.com`);

    // Over plain HTTP the scheme must match or every media request is mixed content.
    text = text.replace(/this.scheme="https"/, 'this.scheme="http"');

    text = text.replace(/https\:\/\/jnn-pa.googleapis.com/g, `${PROXY_PREFIX}https://jnn-pa.googleapis.com`);
    text = text.replace(/https:\/\/yt3\.googleusercontent\.com/g, `${PROXY_PREFIX}https://yt3.googleusercontent.com`);
    text = text.replace(/"\/\/yt3\.googleusercontent\.com/g, `"${PROXY_PREFIX}https://yt3.googleusercontent.com`);

    // Otherwise history entries carry the localhost origin and back navigation dies.
    text = text.replace(/=window\.location\.href;/, `=window.location.href.replace("${LOCAL_ORIGIN}", "https://www.youtube.com");`);
    text = text.replace(/=document\.location\.href/, `=document.location.href.replace("${LOCAL_ORIGIN}", "https://www.youtube.com")`);

    return text;
}

// __Secure- / __Host- prefixed cookies are rejected over plain HTTP, so they are
// renamed in both directions and the HTTPS-only attributes dropped.
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

// Express matches routes in registration order and this catch-all matches everything,
// so it must be attached after the caller's own routes — otherwise /__tube/state gets
// YouTube's HTML instead of JSON and the app never launches.
function create(platformVersion) {
    const app = express();

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


    // Development only, so a packaged service has no such route.
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
/** Reads a request body into memory. Only used for the requests capture asks for. */
function collect(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

// DEV INSTRUMENTATION — temporary, remove before release.
//
// Headers that carry who is asking. Everything else on a player request is boilerplate,
// and printing all of it would bury the one line that matters.
const TELLING = [
    'authorization', 'x-goog-authuser', 'x-goog-pageid', 'x-goog-visitor-id',
    'x-youtube-client-name', 'x-youtube-client-version', 'x-youtube-bootstrap-logged-in',
    'x-youtube-device', 'x-youtube-page-cl', 'x-youtube-page-label', 'x-youtube-utc-offset',
    'x-youtube-identity-token', 'x-goog-request-time', 'x-origin', 'origin', 'referer',
    'content-type', 'user-agent', 'cookie'
];

function notePlayerCall(headers, buffer) {
    try {
        const body = JSON.parse(buffer.toString('utf8'));
        if (!body.videoId || body.licenseRequest) return;

        const said = TELLING
            .filter((name) => headers[name] !== undefined)
            .map((name) => {
                const value = String(headers[name]);
                // Long and secret-ish: how much there is says as much as what it is.
                if (name === 'cookie') return `cookie[${value.split(';').length} names]`;
                if (name === 'authorization') return `authorization[${value.split(' ')[0]} ${value.length}b]`;
                return `${name}=${value.length > 40 ? `${value.slice(0, 37)}...` : value}`;
            });

        journal.service('askedwith', `${body.videoId}: ${said.join(' ')}`);
    } catch (e) {
        // A body shaped differently is not worth failing a request for.
    }
}

// DEV INSTRUMENTATION — temporary, remove before release.
let lastAnswer = '';

function noteAnswer(path, how) {
    const line = `${path.split('?')[0]} ${how}`;
    if (line === lastAnswer) return;
    lastAnswer = line;
    journal.service('innertube', `${line}`);
}

function attachFallback(app) {
    app.all('*', (req, res) => {
        const isBypass = req.path.indexOf('/cors-bypass/') === 0;

        let targetUrl;
        if (isBypass) {
            const raw = req.url.substring('/cors-bypass/'.length);
            targetUrl = raw.indexOf('http') === 0 ? raw : `https://${raw}`;
        } else {
            targetUrl = `https://www.youtube.com${req.url}`;
        }

        const headers = {};
        for (const key in req.headers) {
            if (!Object.prototype.hasOwnProperty.call(req.headers, key)) continue;
            headers[key] = key === 'cookie' ? restoreCookiePrefixes(req.headers[key]) : req.headers[key];
        }

        try {
            headers.host = URL.parse(targetUrl).host;
        } catch (e) {
            headers.host = 'www.youtube.com';
        }

        // Any innertube call can carry media in its answer — a watch-next payload embeds
        // the streams for what it expects to be played, and those arrive with no player
        // request behind them. Which endpoint an encrypted ladder comes from decides
        // where the token has to be stripped.
        const isInnertube = req.path.indexOf('/youtubei/v1/') === 0;

        // Media, which is the only thing large enough to be worth pacing.
        const isMedia = targetUrl.indexOf('videoplayback') !== -1;

        // The two requests whose answers decide what this app can play.
        const isPlayerCall = req.path.indexOf('/youtubei/v1/player') === 0;
        const isNextCall = req.path.indexOf('/youtubei/v1/next') === 0;

        headers.origin = 'https://www.youtube.com';
        if (headers.referer) headers.referer = 'https://www.youtube.com/tv';
        if (DEV_USER_AGENT) headers['user-agent'] = DEV_USER_AGENT;
        // Brotli is not decoded downstream, so ask for encodings we can rewrite.
        headers['accept-encoding'] = 'gzip, deflate';

        // The account is what YouTube applies the encrypted-ladder experiment to: the same
        // request signed with the player's bearer token comes back with formats that are
        // transcoded as they are served and encrypted, and unsigned comes back with the
        // ordinary indexed ladder this app can serve.
        //
        // Only the player call is stripped. Everything else — the guide, subscriptions,
        // history, search — keeps the token, so the app stays signed in.
        // `next` carries the streams for whatever the app expects to play next, and those
        // answers arrive with no player request behind them — so signing only the player
        // call out leaves half the media still coming back encrypted.
        if ((isPlayerCall || isNextCall) && ANONYMOUS_PLAYER) {
            delete headers.authorization;
            delete headers['x-goog-authuser'];
            delete headers['x-goog-pageid'];
        }

        const hasBody = ['POST', 'PUT', 'PATCH'].indexOf(req.method) !== -1;


        // Held rather than streamed: a SABR request is a couple of kilobytes, and reading
        // it is how this service learns the session the page opened.
        const body = hasBody && sabr.observed.wants(req.method, targetUrl)
            ? collect(req).then((buffer) => { sabr.observed.note(targetUrl, buffer); return buffer; })
            : (hasBody && isPlayerCall
                ? collect(req).then((buffer) => { notePlayerCall(headers, buffer); return buffer; })
                : Promise.resolve(hasBody ? req : undefined));

        body.then((payload) => fetch(targetUrl, {
            method: req.method,
            headers,
            body: payload,
            redirect: 'manual',
            agent: agentFor(targetUrl)
        }))
            .then((response) => {
                res.status(req.method === 'OPTIONS' ? 200 : response.status);

                if (isInnertube) noteAnswer(req.path, headers.authorization ? 'signed' : 'anon');

                const raw = response.headers.raw();
                for (const key in raw) {
                    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;

                    const lower = key.toLowerCase();
                    if (STRIPPED_HEADERS.indexOf(lower) !== -1) continue;
                    if (isBypass && lower === 'access-control-allow-origin') continue;

                    if (lower === 'set-cookie' && Array.isArray(raw[key])) {
                        res.setHeader('Set-Cookie', rewriteSetCookie(raw[key]));
                        continue;
                    }

                    res.setHeader(key, response.headers.get(key));
                }

                res.setHeader('Access-Control-Allow-Origin', '*');

                const contentType = response.headers.get('content-type') || '';
                const isTextual = TEXTUAL.some((type) => contentType.indexOf(type) !== -1);

                if (!isTextual) {
                    if (!response.body) return res.end();

                    if (isMedia && media.busy()) return response.body.pipe(trickle()).pipe(res);
                    return response.body.pipe(res);
                }

                return response.text().then((text) => {
                    const body = rewriteBody(text, req.url);
                    res.send(body);
                });
            })
            .catch((error) => {
                console.error(`Proxy error for ${targetUrl}: ${error.message}`);
                if (!res.headersSent) res.status(500).send('Proxy connection broken.');
            });
    });

    return app;
}

module.exports = {
    create, attachFallback, rewriteBody, rewriteSetCookie, restoreCookiePrefixes
};
