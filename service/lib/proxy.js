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
const media = require('./stream.js');

// The page's own player fetches a second copy of every video into a source buffer that
// keeps none of it, and decoding two 2160p60 streams is more than this set can do. Only
// the start of a response: pacing the whole body made a twelve-megabyte reply take over a
// minute, and those connections accumulated until the proxy stopped answering at all.
const HOLD_MS = 250;
const HOLD_FOR_FIRST = 12;
const MOST_HELD_AT_ONCE = 2;

let holding = 0;

function held(source) {
    if (holding >= MOST_HELD_AT_ONCE) return source;

    holding += 1;

    let chunks = 0;
    let done = false;

    const release = () => {
        if (done) return;
        done = true;
        holding -= 1;
    };

    source.on('end', release);
    source.on('error', release);
    source.on('close', release);

    source.on('data', () => {
        chunks += 1;
        if (done || chunks > HOLD_FOR_FIRST) return release();

        source.pause();
        setTimeout(() => source.resume(), HOLD_MS);
        return undefined;
    });

    return source;
}

// Off, because asking for the player response without the account's token is also what
// makes the app believe nobody is signed in: it arrives at guest mode and an account
// picker loop with no way out. Set TUBE_ANON_PLAYER=1 at build time to measure with it on.
const ANONYMOUS_PLAYER = process.env.TUBE_ANON_PLAYER === '1';

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

// TEMPORARY, for the Cobalt container experiment: flipped by hand to bisect our own mods against
// the proxy. `process.env` is no use here — it is read on the television, not at build time.
const INJECT_USERSCRIPT = true;
const INSTRUMENT = true;
const REWRITE_FOR_COBALT = true;

function rewriteBody(text, url, forCobalt) {
    // TEMPORARY: instrumentation only, no mods. Wraps the page's own networking so we can see
    // what the player asks for and, more to the point, what it never asks for.
    if (url.indexOf('/tv') === 0 && url.indexOf('/tv_config') === -1 && INSTRUMENT) {
        // TEMPORARY, for the Cobalt container experiment. The container's player refuses a media
        // URL whose host is not googlevideo, so the response cannot be rewritten — but sending it
        // straight to Google fails CORS, because the origin is ours rather than youtube.com. So
        // the player builds its own URL and this swaps it at send time, same origin, no CORS.
        const spy = '<script>(function(){'
            + `var origin='${LOCAL_ORIGIN}';`
            + 'var beacon=function(w){try{var i=new Image();'
            + "i.src=origin+'/__tube/oops?m='+encodeURIComponent(w);}catch(e){}};"
            + "beacon('shim installed');"
            + 'try{'
            + 'var reroute=function(u){var s=String(u);'
            + "if(s.indexOf('googlevideo.com')===-1)return u;"
            + "if(s.indexOf('/cors-bypass/')!==-1)return u;"
            + "if(s.indexOf('//')===0)s='https:'+s;"
            + "return origin+'/cors-bypass/'+s;};"
            + 'var X=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){'
            + 'var t=reroute(u);'
            + "if(t!==u)beacon('rerouted xhr '+m);"
            + 'arguments[1]=t;return X.apply(this,arguments);};'
            + 'var F=window.fetch;if(F)window.fetch=function(u,o){'
            + 'var s=(u&&u.url)||u;var t=reroute(s);'
            + "if(t!==s){beacon('rerouted fetch');"
            + 'if(u&&u.url){u=new Request(t,u);}else{u=t;}}'
            + 'return F.call(window,u,o);};'
            + "beacon('shim armed');"
            + "}catch(e){beacon('shim threw '+e);}"
            + '})();</script>';
        // Before </body>, not in <head>: the container runs the first and ignores the second.
        if (text.indexOf('</body>') !== -1) text = text.replace('</body>', `${spy}</body>`);
    }

    if (url.indexOf('/tv') === 0 && url.indexOf('/tv_config') === -1 && INJECT_USERSCRIPT) {
        if (DEV_USER_AGENT) text = spoofUserAgent(text);
        // TEMPORARY, for the Cobalt container experiment: Cobalt has no reachable console, so
        // whatever the userscript throws there is invisible. This carries it back to the journal.
        const beacon = '<script>window.onerror=function(m,s,l,c){try{var i=new Image();'
            + `i.src='${LOCAL_ORIGIN}/__tube/oops?m='+encodeURIComponent(m+' @'+s+':'+l+':'+c);`
            + '}catch(e){}};</script>';
        const tag = `<script src="${LOCAL_ORIGIN}/__tube/userScript.js?v=${Date.now()}"></script>`
            + '<script>try{var i=new Image();i.src='
            + `'${LOCAL_ORIGIN}/__tube/oops?m='+encodeURIComponent('secure='+window.isSecureContext`
            + "+' mse='+(typeof window.MediaSource)"
            + "+' eme='+(typeof navigator.requestMediaKeySystemAccess)"
            + "+' origin='+location.origin);}catch(e){}</script>";

        // Appending past </html> is fine in Chromium and is dropped by Cobalt's parser, so the
        // tags go inside the document — last thing before </body>, to keep the timing they had.
        if (text.indexOf('</body>') !== -1) text = text.replace('</body>', `${beacon}${tag}</body>`);
        else text += beacon + tag;
        if (DEV_INJECT_PATH) text += `<script src="${LOCAL_ORIGIN}/__tube/dev.js?v=${Date.now()}"></script>`;
    }

    // TEMPORARY, for the Cobalt container experiment: the whole rewrite table off in one cut, to
    // find out whether any of it is what stops the container's player from ever fetching media.
    if (forCobalt && !REWRITE_FOR_COBALT) return text;

    // TEMPORARY, for the Cobalt container experiment: the container's player never builds a media
    // URL at all when these are rewritten — it has the formats and a token, does its eligibility
    // check, then stops. Left alone it talks to googlevideo directly over https, which is what the
    // stock app does and what plays. We lose media interception there; the enhanced player is off
    // in the container anyway.
    if (!forCobalt) {
        text = text.replace(/https:\/\/([a-zA-Z0-9-.]+)\.googlevideo\.com/g, `${PROXY_PREFIX}https://$1.googlevideo.com`);
        text = text.replace(/https:\\\/\\\/([a-zA-Z0-9-.]+)\.googlevideo\.com/g, `http:\\\/\\\/${PROXY_HOST}:${ports.PROXY}\\\/cors-bypass\\\/https:\\\/\\\/$1.googlevideo.com`);
        text = text.replace(/"\/\/([a-zA-Z0-9-.]+)\.googlevideo\.com/g, `"${PROXY_PREFIX}https://$1.googlevideo.com`);
    }

    // Three spellings each, because YouTube emits absolute, escaped and protocol-relative
    // forms.

    text = text.replace(/https:\/\/www\.gstatic\.com/g, `${PROXY_PREFIX}https://www.gstatic.com`);
    text = text.replace(/http:\/\/www\.gstatic\.com/g, `${PROXY_PREFIX}https://www.gstatic.com`);
    text = text.replace(/"\/\/www\.gstatic\.com/g, `"${PROXY_PREFIX}https://www.gstatic.com`);
    text = text.replace(/\(\/\/www\.gstatic\.com/g, `(${PROXY_PREFIX}https://www.gstatic.com`);

    text = text.replace(/https:\/\/yt3\.ggpht\.com/g, `${PROXY_PREFIX}https://yt3.ggpht.com`);

    text = text.replace(/https:\/\/clients1\.google\.com/g, `${PROXY_PREFIX}https://clients1.google.com`);
    text = text.replace(/http:\/\/clients1\.google\.com/g, `${PROXY_PREFIX}https://clients1.google.com`);
    text = text.replace(/"\/\/clients1\.google\.com/g, `"${PROXY_PREFIX}https://clients1.google.com`);

    // Without localhost in YouTube's postMessage allowlist, sign-in is dropped.
    text = text.replace('Set(["www.youtube.com","accounts.google.com"]);', `Set(["www.youtube.com", "accounts.google.com", "localhost", ${JSON.stringify(PROXY_HOST)}]);`);

    // Telemetry and player code compare the embedded page URL against the real origin.
    text = text.replace(/:document\.location\.toString\(\)/g, `:document.location.toString().replace("${LOCAL_ORIGIN}", "https://www.youtube.com")`);
    text = text.replace(/euri:[^,]+,/g, `euri:document.location.toString().replace("${LOCAL_ORIGIN}", "https://www.youtube.com"),`);

    text = text.replace(/https:\/\/s\.youtube\.com/g, `${PROXY_PREFIX}https://s.youtube.com`);
    text = text.replace(/redirector.googlevideo.com/g, `${PROXY_PREFIX}https://redirector.googlevideo.com`);

    // Over plain HTTP the scheme must match or every media request is mixed content. Not in the
    // Cobalt container, though: it refuses plain HTTP to any public host, so forcing the scheme
    // down makes the player build a media URL its own network layer drops before requesting it —
    // no request, no error, just a player that retries for ever.
    if (!forCobalt) text = text.replace(/this.scheme="https"/, 'this.scheme="http"');

    text = text.replace(/https\:\/\/jnn-pa.googleapis.com/g, `${PROXY_PREFIX}https://jnn-pa.googleapis.com`);
    text = text.replace(/https:\/\/yt3\.googleusercontent\.com/g, `${PROXY_PREFIX}https://yt3.googleusercontent.com`);
    text = text.replace(/"\/\/yt3\.googleusercontent\.com/g, `"${PROXY_PREFIX}https://yt3.googleusercontent.com`);

    // Otherwise history entries carry the localhost origin and back navigation dies.
    text = text.replace(/=window\.location\.href;/, `=window.location.href.replace("${LOCAL_ORIGIN}", "https://www.youtube.com");`);
    text = text.replace(/=document\.location\.href/, `=document.location.href.replace("${LOCAL_ORIGIN}", "https://www.youtube.com")`);

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

    app.use((req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
        res.setHeader('Access-Control-Allow-Headers', '*');
        if (req.method === 'OPTIONS') return res.status(200).end();
        next();
    });

    // TEMPORARY, for the Cobalt container experiment: where the page's errors come back to.
    app.get('/__tube/oops', (req, res) => {
        const said = String((req.query && req.query.m) || '').slice(0, 400);
        journal.service('cobalt', said);
        // The journal only records once the dev bridge has opened it, and in the container it
        // never does, so this one goes straight to the file.
        try {
            require('fs').appendFileSync('/home/owner/share/tube/service.log',
                `${new Date().toISOString()}  cobalt threw: ${said}\n`);
        } catch (e) { /* off-TV, or no such directory */ }
        res.type('image/gif').status(204).end();
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
function collect(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

// TODO: remove before release.
const TELLING = [
    'authorization', 'x-goog-authuser', 'x-goog-pageid', 'x-goog-visitor-id',
    'x-youtube-client-name', 'x-youtube-client-version', 'x-youtube-bootstrap-logged-in',
    'x-youtube-device', 'x-youtube-page-cl', 'x-youtube-page-label', 'x-youtube-utc-offset',
    'x-youtube-identity-token', 'x-goog-request-time', 'x-origin', 'origin', 'referer',
    'content-type', 'user-agent', 'cookie'
];

// `context.client.deviceMake` is what YouTube keys the encrypted-ladder experiment to on
// this client.
function askUnbranded(headers, buffer) {
    notePlayerCall(headers, buffer);

    let body;
    try {
        body = JSON.parse(buffer.toString('utf8'));
    } catch (e) {
        return buffer;
    }

    const client = (body.context || {}).client;
    if (!client || client.deviceMake === undefined || body.licenseRequest) return buffer;

    // Not in the Cobalt container: stripping the brand is a Chromium-side workaround, and the
    // container's player is the one YouTube actually targets. Leave its request untouched.
    if (/Cobalt/i.test(String(headers['user-agent'] || ''))) return buffer;

    delete client.deviceMake;

    const plain = Buffer.from(JSON.stringify(body), 'utf8');
    headers['content-length'] = String(plain.length);

    if (!unbranded) {
        unbranded = true;
        journal.service('innertube', 'asking without deviceMake — that field is what the '
            + 'encrypted ladder is keyed to');
    }

    return plain;
}

let unbranded = false;

function notePlayerCall(headers, buffer) {
    if (!journal.wanted()) return;

    try {
        const body = JSON.parse(buffer.toString('utf8'));
        if (!body.videoId || body.licenseRequest) return;

        const said = TELLING
            .filter((name) => headers[name] !== undefined)
            .map((name) => {
                const value = String(headers[name]);
                if (name === 'cookie') return `cookie[${value.split(';').length} names]`;
                if (name === 'authorization') return `authorization[${value.split(' ')[0]} ${value.length}b]`;
                return `${name}=${value.length > 40 ? `${value.slice(0, 37)}...` : value}`;
            });

        journal.service('askedwith', `${body.videoId}: ${said.join(' ')}`);
    } catch (e) {
    }
}

// TODO: remove before release.
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

        // Any innertube call can carry media in its answer — a watch-next payload embeds the
        // streams for what it expects to be played — so which endpoint an encrypted ladder comes
        // from decides where the token has to be stripped.
        const isInnertube = req.path.indexOf('/youtubei/v1/') === 0;

        const isMedia = targetUrl.indexOf('videoplayback') !== -1;

        const isPlayerCall = req.path.indexOf('/youtubei/v1/player') === 0;

        headers.origin = 'https://www.youtube.com';
        if (headers.referer) headers.referer = 'https://www.youtube.com/tv';
        if (DEV_USER_AGENT) headers['user-agent'] = DEV_USER_AGENT;
        // Brotli is not decoded downstream, so ask for encodings we can rewrite.
        headers['accept-encoding'] = 'gzip, deflate';

        // Signed with the player's bearer token the response carries formats transcoded as
        // they are served and encrypted; unsigned it carries the ordinary indexed ladder.
        // Only the player call: signing `next` out too reads as a client worth challenging,
        // and starts the account picker looping with no way out.
        if (isPlayerCall && ANONYMOUS_PLAYER) {
            delete headers.authorization;
            delete headers['x-goog-authuser'];
            delete headers['x-goog-pageid'];
        }

        const hasBody = ['POST', 'PUT', 'PATCH'].indexOf(req.method) !== -1;

        // Held rather than streamed: a SABR request is a couple of kilobytes, and reading it is
        // how this service learns the session the page opened.
        const body = hasBody && sabr.observed.wants(req.method, targetUrl)
            ? collect(req).then((buffer) => { sabr.observed.note(targetUrl, buffer); return buffer; })
            : (hasBody && isPlayerCall
                ? collect(req).then((buffer) => askUnbranded(headers, buffer))
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

                    if (isMedia && media.busy()) return held(response.body).pipe(res);
                    return response.body.pipe(res);
                }

                return response.text().then((text) => {
                    const body = rewriteBody(text, req.url, /Cobalt/i.test(req.get('user-agent') || ''));
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
