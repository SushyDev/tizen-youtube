"use strict";

// MITM proxy: DEVELOPMENT ONLY. It is not reachable from `service/index.js` and ncc
// never bundles it, so nothing here ships to a television.
//
// It exists because `npm run dev` has no debugger to inject with: off a TV there is no
// sdb daemon, so the only way to get the userscript into youtube.com in a desktop
// browser is to serve youtube.com from localhost and splice a script tag in. On a TV
// that job belongs to `lib/injector.js` and this file has no part in it.
//
// The rewrite table is ported unchanged from the reference — it is empirically derived
// and every rule is load bearing.

const fetch = require('node-fetch');
const URL = require('url');
const { readFileSync } = require('fs');

const ports = require('../lib/ports.js');
const loader = require('../lib/loader.js');

const PROXY_PREFIX = `http://localhost:${ports.SERVICE}/cors-bypass/`;
const LOCAL_ORIGIN = `http://localhost:${ports.SERVICE}`;

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
    text = text.replace(/https:\\\/\\\/([a-zA-Z0-9-.]+)\.googlevideo\.com/g, `http:\\\/\\\/localhost:${ports.SERVICE}\\\/cors-bypass\\\/https:\\\/\\\/$1.googlevideo.com`);
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

// Everything this module adds, in the order Express has to see it. The catch-all below
// matches every path, so it goes last: attached before the service's own routes,
// /__tube/state is answered with YouTube's HTML and the app never launches.
// `service/test/routing.js` pins that ordering.
function attachDev(app, platformVersion) {
    // On the injected path the script is evaluated straight into the page and never
    // fetched. This route exists for the script tag the proxy splices in, which is a
    // development mechanism only.
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

    attachFallback(app);

    return app;
}

// Must be called after every other route is registered.
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

        headers.origin = 'https://www.youtube.com';
        if (headers.referer) headers.referer = 'https://www.youtube.com/tv';
        if (DEV_USER_AGENT) headers['user-agent'] = DEV_USER_AGENT;
        // Brotli is not decoded downstream, so ask for encodings we can rewrite.
        headers['accept-encoding'] = 'gzip, deflate';

        const hasBody = ['POST', 'PUT', 'PATCH'].indexOf(req.method) !== -1;

        fetch(targetUrl, {
            method: req.method,
            headers,
            body: hasBody ? req : undefined,
            // Followed here, not handed back. A 3xx passed through carries an absolute
            // https Location that this table never rewrote, so the page would leave the
            // proxy mid-stream — which for a media segment means the player simply stops
            // being fed. googlevideo redirects constantly, so this is the difference
            // between video playing and a MediaSource that attaches and never fills.
            redirect: 'follow'
        })
            .then((response) => {
                res.status(req.method === 'OPTIONS' ? 200 : response.status);

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
                    if (response.body) return response.body.pipe(res);
                    return res.end();
                }

                return response.text().then((text) => res.send(rewriteBody(text, req.url)));
            })
            .catch((error) => {
                console.error(`Proxy error for ${targetUrl}: ${error.message}`);
                if (!res.headersSent) res.status(500).send('Proxy connection broken.');
            });
    });

    return app;
}

module.exports = { attachDev, attachFallback, rewriteBody, rewriteSetCookie, restoreCookiePrefixes };
