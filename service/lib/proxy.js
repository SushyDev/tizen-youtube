"use strict";

// MITM proxy: the fallback path when Developer Mode is off.
//
// Everything of youtube.com is proxied through localhost so the userscript can
// be injected with a plain script tag and CSP never applies. The rewrite table
// below is ported unchanged from the reference implementation on purpose: it
// is empirically derived against YouTube's TV client and every rule is load
// bearing. What has changed is that each rule now says what it fixes, and the
// injected script comes from this service rather than from a CDN.

const express = require('express');
const fetch = require('node-fetch');
const URL = require('url');
const { readFileSync } = require('fs');

const ports = require('./ports.js');
const loader = require('./loader.js');

const PROXY_PREFIX = `http://localhost:${ports.PROXY}/cors-bypass/`;
const LOCAL_ORIGIN = `http://localhost:${ports.PROXY}`;

// Development only, and empty on a television.
//
// youtube.com/tv decides from the user agent whether the caller is a TV. A
// desktop browser gets a "you are being redirected to youtube.com" page
// instead of the client, so off-TV there is nothing to develop against. With
// TUBE_DEV_UA set, the proxy presents itself upstream as the television and
// tells the page to say the same thing about itself — the app reads
// navigator.userAgent too, and a page served as a TV but reporting a desktop
// browser is a shape neither side expects. Nothing sets this on a TV, where
// the webview's own user agent is already the right one.
const DEV_USER_AGENT = process.env.TUBE_DEV_UA || '';

// Development only, and empty on a television. A path to one more script to
// put into the page after the userscript — `npm run dev` points it at
// ui/dev/remote.js, which puts the remote's keys on a keyboard. Served from
// disk on every request so editing it needs no restart.
const DEV_INJECT_PATH = process.env.TUBE_DEV_INJECT || '';

// Responses of these types are rewritten as text; everything else is streamed
// straight through so video bytes are never buffered.
const TEXTUAL = ['text/html', 'application/json', 'javascript', 'text/css'];

// Hop-by-hop and security headers that must not be forwarded. Dropping the CSP
// is what lets the injected script run at all.
const STRIPPED_HEADERS = [
    'content-encoding', 'content-length', 'transfer-encoding',
    'content-security-policy', 'alt-svc'
];

// Makes the page agree with the request that fetched it. Development only:
// see DEV_USER_AGENT. First thing in the head, because the client reads the
// user agent while deciding what kind of device it is running on, and that
// happens in its very first script.
function spoofUserAgent(text) {
    const shim = '<script>try{Object.defineProperty(navigator,"userAgent",' +
        `{get:function(){return ${JSON.stringify(DEV_USER_AGENT)};},configurable:true});` +
        '}catch(e){}</script>';

    // No <head> to open means an unexpected shape; leaving it alone is safer
    // than guessing where the first script is.
    return text.indexOf('<head>') === -1 ? text : text.replace('<head>', `<head>${shim}`);
}

function rewriteBody(text, url) {
    // Inject the userscript into the TV app shell only, not into every page.
    if (url.indexOf('/tv') === 0 && url.indexOf('/tv_config') === -1) {
        if (DEV_USER_AGENT) text = spoofUserAgent(text);
        text += `<script src="${LOCAL_ORIGIN}/__tube/userScript.js?v=${Date.now()}"></script>`;
        // After the userscript, so it can drive what the userscript installed.
        if (DEV_INJECT_PATH) text += `<script src="${LOCAL_ORIGIN}/__tube/dev.js?v=${Date.now()}"></script>`;
    }

    // Media and static hosts: routed through the bypass so the page's own
    // origin checks and CORS both stay happy. Three spellings each, because
    // YouTube emits absolute, escaped and protocol-relative forms.
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

    // YouTube keeps an allowlist of origins it will post messages to; without
    // localhost in it, sign-in and several player messages are dropped.
    text = text.replace('Set(["www.youtube.com","accounts.google.com"]);', 'Set(["www.youtube.com", "accounts.google.com", "localhost"]);');

    // Telemetry and player code embed the page URL and compare it against the
    // real origin. Reporting the canonical origin keeps those checks passing.
    text = text.replace(/:document\.location\.toString\(\)/g, `:document.location.toString().replace("${LOCAL_ORIGIN}", "https://www.youtube.com")`);
    text = text.replace(/euri:[^,]+,/g, `euri:document.location.toString().replace("${LOCAL_ORIGIN}", "https://www.youtube.com"),`);

    text = text.replace(/https:\/\/s\.youtube\.com/g, `${PROXY_PREFIX}https://s.youtube.com`);
    text = text.replace(/redirector.googlevideo.com/g, `${PROXY_PREFIX}https://redirector.googlevideo.com`);

    // The player builds media URLs from this scheme; over plain HTTP it has to
    // match or every media request is blocked as mixed content.
    text = text.replace(/this.scheme="https"/, 'this.scheme="http"');

    text = text.replace(/https\:\/\/jnn-pa.googleapis.com/g, `${PROXY_PREFIX}https://jnn-pa.googleapis.com`);
    text = text.replace(/https:\/\/yt3\.googleusercontent\.com/g, `${PROXY_PREFIX}https://yt3.googleusercontent.com`);
    text = text.replace(/"\/\/yt3\.googleusercontent\.com/g, `"${PROXY_PREFIX}https://yt3.googleusercontent.com`);

    // Without these, history entries carry the localhost origin and back
    // navigation lands on a dead URL.
    text = text.replace(/=window\.location\.href;/, `=window.location.href.replace("${LOCAL_ORIGIN}", "https://www.youtube.com");`);
    text = text.replace(/=document\.location\.href/, `=document.location.href.replace("${LOCAL_ORIGIN}", "https://www.youtube.com")`);

    return text;
}

// Cookies with the __Secure- / __Host- prefixes are rejected by the browser
// over plain HTTP, so they are renamed in both directions and the attributes
// that require HTTPS are dropped.
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

// Express matches routes in registration order, and the proxy's catch-all
// matches everything. So creation is split in two: this sets up middleware and
// the routes the proxy itself owns, and attachFallback() adds the catch-all
// once the caller has registered its own endpoints. Registering the catch-all
// here would shadow them, and the app shell polling /__tube/state would get
// YouTube's HTML instead of JSON and never launch.
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

    // Development only: see DEV_INJECT_PATH. Not registered at all without it,
    // so a packaged service has no such route.
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
            redirect: 'manual'
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

module.exports = { create, attachFallback, rewriteBody, rewriteSetCookie, restoreCookiePrefixes };
