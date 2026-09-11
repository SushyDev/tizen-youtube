'use strict';

// Where a request is really going, and what it should carry when it gets there.

const URL = require('url');

const forward = require('./forward.js');
const dev = require('../dev/index.js');
const { upstream } = require('./knobs.js');
const { restoreCookiePrefixes } = require('./rewrites.js');

const YOUTUBE_HOST = 'www.youtube.com';
const YOUTUBE_ORIGIN = `https://${YOUTUBE_HOST}`;

const GOOGLE = /(^|\.)(youtube\.com|googlevideo\.com|googleapis\.com|google\.com|ggpht\.com|gstatic\.com|googleusercontent\.com)$/;

const overOurTls = (req) => !!(req.socket && req.socket.encrypted);

const routeFor = (req) => {
    const bypassTarget = () => {
        const raw = req.url.substring('/cors-bypass/'.length);
        return raw.indexOf('http') === 0 ? raw : `https://${raw}`;
    };

    const targetOf = (forwarded, isBypass) => {
        if (forwarded) return forwarded;
        if (isBypass) return bypassTarget();
        if (overOurTls(req) && req.headers.host) return `https://${req.headers.host}${req.url}`;

        return `${YOUTUBE_ORIGIN}${req.url}`;
    };

    const hostNamedBy = (target) => {
        try { return URL.parse(target).host || YOUTUBE_HOST; } catch (e) { return YOUTUBE_HOST; }
    };

    // The page is plain HTTP, so Google URLs it builds may carry http: and are upgraded here.
    const upgradeScheme = (target, forGoogle) => (
        forGoogle && target.indexOf('http://') === 0 ? `https://${target.slice(7)}` : target
    );

    const forwarded = forward.absoluteTarget(req.url);
    const isBypass = !forwarded && req.path.indexOf('/cors-bypass/') === 0;

    const target = targetOf(forwarded, isBypass);
    const host = hostNamedBy(target);
    const forGoogle = GOOGLE.test(host.split(':')[0]);

    return {
        url: upgradeScheme(target, forGoogle),
        host,
        forGoogle,
        isBypass,
        asTheRealHost: !!forwarded || overOurTls(req)
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
        // The page only carries renamed cookies when we served it as the service on plain HTTP.
        .map((key) => [key, key === 'cookie' && !route.asTheRealHost
            ? restoreCookiePrefixes(req.headers[key])
            : req.headers[key]]);

    return dev.upstreamHeaders(Object.assign({}, Object.fromEntries(copied), { host: route.host }, presented,
        // Brotli is not decoded here, so ask for encodings that can be read.
        { 'accept-encoding': 'gzip, deflate' }));
};

module.exports = { overOurTls, routeFor, headersFor, YOUTUBE_ORIGIN };
