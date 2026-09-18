'use strict';

const dev = require('../dev/index.js');
const { flagOverrides, upstream } = require('./knobs.js');
const { PROXY_HOST, localOrigin, proxyPrefix } = require('./origin.js');
const { reporter, bootBeacon } = require('./pageReporter.js');

// SABR's one media URL goes through the service so no page patch is needed to reach googlevideo.
const rerouteAbr = (text) => text.replace(
    /"serverAbrStreamingUrl":"(https:\\?\/\\?\/[^"]+)"/g,
    (whole, url) => `"serverAbrStreamingUrl":"${proxyPrefix()}${url}"`
);

// kabuki and the player both prefix every innertube call with INNERTUBE_HOST_OVERRIDE.
const overrideInnertubeHost = (text) => text.replace(
    '"INNERTUBE_CONTEXT_CLIENT_NAME"',
    `"INNERTUBE_HOST_OVERRIDE":${JSON.stringify(localOrigin())},"INNERTUBE_CONTEXT_CLIENT_NAME"`
);

// Matched by host; the prefix keeps the match's escaping.
const ATTESTATION = /(?:https?:)?((?:\\?\/){2})(jnn-pa\.googleapis\.com|www\.google\.com(?=\\?\/js\\?\/th\\?\/))/g;

const rewriteAttestation = (text) => text.replace(ATTESTATION, (whole, slashes, host) => {
    const prefix = slashes.indexOf('\\') === -1 ? proxyPrefix() : proxyPrefix().replace(/\//g, '\\/');
    return `${prefix}https:${slashes}${host}`;
});

const BLOB = /(serializedExperimentFlags\\?":\\?")((?:[^"\\]|\\u[0-9a-fA-F]{4})*)/g;

const retuneFlag = (blob, [name, value]) => {
    const flag = new RegExp(`(^|\\\\u0026|&)${name}(\\\\u003d|=)[^\\\\&]*`);

    if (flag.test(blob)) {
        return blob.replace(flag, (whole, separator, equals) => `${separator}${name}${equals}${value}`);
    }

    // An absent flag reads as off.
    return `${name}\\u003d${value}\\u0026${blob}`;
};

const retuneFlags = (text) => text.replace(BLOB, (whole, lead, blob) => (
    `${lead}${Array.from(flagOverrides).reduce(retuneFlag, blob)}`
));

// The engine loads fonts and CSS images itself, and Cobalt refuses the http: origin such a URL
// inherits from us when the host is public.
const STATIC_HOSTS = ['www.gstatic.com', 'fonts.gstatic.com'];

const rewriteStaticHosts = (text) => {
    const prefix = proxyPrefix();

    return STATIC_HOSTS.reduce((out, host) => {
        const escaped = host.replace(/\./g, '\\.');

        return out
            .replace(new RegExp(`https?://${escaped}`, 'g'), `${prefix}https://${host}`)
            .replace(new RegExp(`(["'(])//${escaped}`, 'g'), `$1${prefix}https://${host}`);
    }, text);
};

const rewriteBody = (text, url) => {
    if (url.indexOf('/tv') !== 0 || url.indexOf('/tv_config') !== -1) return text;

    const tuned = [
        dev.spoofUserAgent,
        flagOverrides.size ? retuneFlags : null,
        upstream.nativeProxyPatches ? null : overrideInnertubeHost
    ].filter(Boolean).reduce((out, step) => step(out), text);

    const origin = localOrigin();

    const tag = `<script>window.__TUBE_NATIVE_PROXY_PATCHES__=${upstream.nativeProxyPatches};</script>`
        + `<script src="${origin}/__tube/userScript.js?v=${Date.now()}"></script>`
        + `<script>${bootBeacon(origin)}</script>`
        + dev.pageScripts(origin, '');

    // First in the body, so it sees the page's errors; Cobalt ignores what is added to <head>.
    const reported = tuned.replace(/<body[^>]*>/, (open) => `${open}<script>${reporter(origin)}</script>`);

    // Appended past </html> a browser still runs it; Cobalt's parser drops it.
    return reported.indexOf('</body>') !== -1 ? reported.replace('</body>', `${tag}</body>`) : reported + tag;
};

// __Secure- and __Host- prefixed cookies are rejected over plain HTTP.
const rewriteSetCookie = (values) => values.map((cookie) => cookie
    .replace(/^__Secure-/i, '__LocalSecure-')
    .replace(/^__Host-/i, '__LocalHost-')
    .replace(/Domain=[^;]+/i, `Domain=${PROXY_HOST}`)
    .replace(/;\s*Secure/i, '')
    .replace(/;\s*SameSite=None/i, '')
    .replace(/;\s*;/g, ';')
    .replace(/;\s*$/, ''));

const restoreCookiePrefixes = (header) => header
    .replace(/__LocalSecure-/g, '__Secure-')
    .replace(/__LocalHost-/g, '__Host-');

// kabuki reads env_ switches from its own URL and watermarks any origin but YouTube's without
// this one.
const HIDE_WATERMARK = 'env_hideWatermark=true';

const hidesWatermark = (url) => String(url).indexOf('env_hideWatermark=') !== -1;

const withHiddenWatermark = (url) => `${url}${String(url).indexOf('?') === -1 ? '?' : '&'}${HIDE_WATERMARK}`;

module.exports = {
    rerouteAbr, overrideInnertubeHost, rewriteAttestation, retuneFlags,
    rewriteBody, rewriteSetCookie, restoreCookiePrefixes,
    hidesWatermark, withHiddenWatermark, rewriteStaticHosts
};
