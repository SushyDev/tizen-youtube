'use strict';

// Pure text rewrites of proxied bodies and headers.

const dev = require('../dev/index.js');
const { flagOverrides, upstream } = require('./knobs.js');
const { localOrigin, proxyPrefix } = require('./origin.js');

const nonceOf = (policy) => (/'nonce-([A-Za-z0-9+/_-]+={0,2})'/.exec(policy || '') || [])[1] || null;

// Routes SABR's single media URL through the service so no page patch is needed to reach
// googlevideo.
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

// BotGuard's program URL arrives protocol-relative inside a JSON string, so its quotes and slashes
// may be escaped.
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

const BLOB = /(serializedExperimentFlags\\?":\\?")((?:[^"\\]|\\u[0-9a-fA-F]{4})*)/g;

const retuneFlag = (blob, [name, value]) => {
    const flag = new RegExp(`(^|\\\\u0026|&)${name}(\\\\u003d|=)[^\\\\&]*`);

    if (flag.test(blob)) {
        return blob.replace(flag, (whole, separator, equals) => `${separator}${name}${equals}${value}`);
    }

    // An absent flag reads as off, so turning one on means adding it to the front of the blob.
    return `${name}\\u003d${value}\\u0026${blob}`;
};

const retuneFlags = (text) => text.replace(BLOB, (whole, lead, blob) => (
    `${lead}${Array.from(flagOverrides).reduce(retuneFlag, blob)}`
));

// Cobalt refuses whatever the policy does not name, so connect-src and img-src are widened for
// our fetches and DeArrow's images.
const GRANTS = [
    { named: /(^|;)(\s*)connect-src[^;]*/i, widened: 'connect-src * data: blob: ws: wss:' },
    { named: /(^|;)(\s*)img-src[^;]*/i, widened: 'img-src * data: blob:' }
];

// Replaced where the directive is named, appended where it is not: a policy that never mentioned
// it is still governed by default-src, so leaving it out is the same denial.
const granted = (policy, grant) => (grant.named.test(policy)
    ? policy.replace(grant.named, `$1$2${grant.widened}`)
    : `${policy}; ${grant.widened}`);

// YouTube sends two policies and both are enforced, so each needs the grants.
const withOurGrants = (policy) => {
    if (!policy) return policy;

    return String(policy).split(',').map((one) => GRANTS.reduce(granted, one)).join(',');
};

const rewriteBody = (text, url, injectionOrigin, nonce) => {
    if (url.indexOf('/tv') !== 0 || url.indexOf('/tv_config') !== -1) return text;

    const tuned = [
        dev.spoofUserAgent,
        flagOverrides.size ? retuneFlags : null,
        upstream.nativeProxyPatches ? null : overrideInnertubeHost
    ].filter(Boolean).reduce((out, step) => step(out), text);

    const stamp = nonce ? ` nonce="${nonce}"` : '';
    const origin = injectionOrigin || localOrigin();

    const tag = `<script${stamp}>window.__TUBE_NATIVE_PROXY_PATCHES__=${upstream.nativeProxyPatches};</script>`
        + `<script${stamp} src="${origin}/__tube/userScript.js?v=${Date.now()}"></script>`
        + dev.pageScripts(origin, stamp);

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

module.exports = {
    nonceOf, rerouteAbr, overrideInnertubeHost, rewriteAttestation, retuneFlags,
    withOurGrants, rewriteBody, rewriteSetCookie, restoreCookiePrefixes
};
