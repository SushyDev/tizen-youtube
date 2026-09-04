"use strict";

const express = require('express');
const fetch = require('node-fetch');
const URL = require('url');
const { readFileSync } = require('fs');

const ports = require('./ports.js');
const loader = require('./loader.js');

const PROXY_PREFIX = `http://localhost:${ports.PROXY}/cors-bypass/`;
const LOCAL_ORIGIN = `http://localhost:${ports.PROXY}`;

const DEV_USER_AGENT = process.env.TUBE_DEV_UA || '';

const DEV_INJECT_PATH = process.env.TUBE_DEV_INJECT || '';

const TEXTUAL = ['text/html', 'application/json', 'javascript', 'text/css'];

const STRIPPED_HEADERS = [
    'content-encoding', 'content-length', 'transfer-encoding',
    'content-security-policy', 'alt-svc'
];

function spoofUserAgent(text) {
    const shim = '<script>try{Object.defineProperty(navigator,"userAgent",' +
        `{get:function(){return ${JSON.stringify(DEV_USER_AGENT)};},configurable:true});` +
        '}catch(e){}</script>';

    return text.indexOf('<head>') === -1 ? text : text.replace('<head>', `<head>${shim}`);
}

function rewriteBody(text, url) {
    if (url.indexOf('/tv') === 0 && url.indexOf('/tv_config') === -1) {
        if (DEV_USER_AGENT) text = spoofUserAgent(text);
        text += `<script src="${LOCAL_ORIGIN}/__tube/userScript.js?v=${Date.now()}"></script>`;
        if (DEV_INJECT_PATH) text += `<script src="${LOCAL_ORIGIN}/__tube/dev.js?v=${Date.now()}"></script>`;
    }

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

    text = text.replace('Set(["www.youtube.com","accounts.google.com"]);', 'Set(["www.youtube.com", "accounts.google.com", "localhost"]);');

    text = text.replace(/:document\.location\.toString\(\)/g, `:document.location.toString().replace("${LOCAL_ORIGIN}", "https://www.youtube.com")`);
    text = text.replace(/euri:[^,]+,/g, `euri:document.location.toString().replace("${LOCAL_ORIGIN}", "https://www.youtube.com"),`);

    text = text.replace(/https:\/\/s\.youtube\.com/g, `${PROXY_PREFIX}https://s.youtube.com`);
    text = text.replace(/redirector.googlevideo.com/g, `${PROXY_PREFIX}https://redirector.googlevideo.com`);

    text = text.replace(/this.scheme="https"/, 'this.scheme="http"');

    text = text.replace(/https\:\/\/jnn-pa.googleapis.com/g, `${PROXY_PREFIX}https://jnn-pa.googleapis.com`);
    text = text.replace(/https:\/\/yt3\.googleusercontent\.com/g, `${PROXY_PREFIX}https://yt3.googleusercontent.com`);
    text = text.replace(/"\/\/yt3\.googleusercontent\.com/g, `"${PROXY_PREFIX}https://yt3.googleusercontent.com`);

    text = text.replace(/=window\.location\.href;/, `=window.location.href.replace("${LOCAL_ORIGIN}", "https://www.youtube.com");`);
    text = text.replace(/=document\.location\.href/, `=document.location.href.replace("${LOCAL_ORIGIN}", "https://www.youtube.com")`);

    return text;
}

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

function create(platformVersion) {
    const app = express();

    app.use((req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
        res.setHeader('Access-Control-Allow-Headers', '*');
        if (req.method === 'OPTIONS') return res.status(200).end();
        next();
    });

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
