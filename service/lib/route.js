'use strict';

const URL = require('url');

const dev = require('../dev/index.js');
const { upstream } = require('./knobs.js');
const { restoreCookiePrefixes } = require('./rewrites.js');

const YOUTUBE_HOST = 'www.youtube.com';
const YOUTUBE_ORIGIN = `https://${YOUTUBE_HOST}`;

const GOOGLE = /(^|\.)(youtube\.com|googlevideo\.com|googleapis\.com|google\.com|ggpht\.com|gstatic\.com|googleusercontent\.com)$/;

const routeFor = (req) => {
    const bypassTarget = () => {
        const raw = req.url.substring('/cors-bypass/'.length);
        return raw.indexOf('http') === 0 ? raw : `https://${raw}`;
    };

    const hostNamedBy = (target) => {
        try { return URL.parse(target).host || YOUTUBE_HOST; } catch (e) { return YOUTUBE_HOST; }
    };

    // The page is plain HTTP, so Google URLs it builds may carry http:.
    const upgradeScheme = (target, forGoogle) => (
        forGoogle && target.indexOf('http://') === 0 ? `https://${target.slice(7)}` : target
    );

    // Everything arrives as a path on our own origin: there is no proxy to hand us an absolute URI.
    const isBypass = req.path.indexOf('/cors-bypass/') === 0;

    const target = isBypass ? bypassTarget() : `${YOUTUBE_ORIGIN}${req.url}`;
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
        // The page carries renamed cookies, because we serve it over plain HTTP as ourselves.
        .map((key) => [key, key === 'cookie'
            ? restoreCookiePrefixes(req.headers[key])
            : req.headers[key]]);

    return dev.upstreamHeaders(Object.assign({}, Object.fromEntries(copied), { host: route.host }, presented,
        // Brotli is not decoded here.
        { 'accept-encoding': 'gzip, deflate' }));
};

module.exports = { routeFor, headersFor, YOUTUBE_ORIGIN };
