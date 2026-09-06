'use strict';

// Read at module load, so it has to be set before the proxy is required.
process.env.TUBE_PROXY_HOST = 'tv.example';

const {
    rewriteBody, rewriteAttestation, rewriteSetCookie, restoreCookiePrefixes, withOurConnections
} = require('../lib/proxy.js');

const ORIGIN = 'http://tv.example:8099';

let failures = 0;

function check(label, ok, detail) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  ${detail}`}`);
    if (!ok) failures += 1;
}

const UNTOUCHED = [
    ['absolute googlevideo', 'var u="https://r5---sn-abc.googlevideo.com/videoplayback?x=1";'],
    ['escaped googlevideo', 'var u="https:\\/\\/r5---sn-abc.googlevideo.com\\/videoplayback";'],
    ['protocol-relative gv', 'src="//r1---sn-xyz.googlevideo.com/foo"'],
    ['gstatic', 'a="https://www.gstatic.com/x";'],
    ['origin allowlist', 'var o=new Set(["www.youtube.com","accounts.google.com"]);'],
    ['location href', 'var a=window.location.href;'],
    ['player scheme', 'this.scheme="https";this.host="x"']
];

const PLAYER_PATH = '/s/player/abc/tv-player-es6-tcl.js';
const served = (source) => rewriteAttestation(rewriteBody(source, PLAYER_PATH), `https://www.youtube.com${PLAYER_PATH}`);

UNTOUCHED.forEach(([label, source]) => {
    check(`${label} is left alone`, served(source) === source, served(source));
});

const injected = rewriteBody('<html><body></body></html>', '/tv');
check('/tv gets the service\'s own script', injected.indexOf(`${ORIGIN}/__tube/userScript.js`) !== -1, injected);
check('/tv script goes inside the document', injected.indexOf('</body>') > injected.indexOf('__tube'), injected);
check('/tv is injected into exactly once', injected.split('__tube/userScript.js').length === 2);

check('/tv_config is not injected into', rewriteBody('<html></html>', '/tv_config').indexOf('__tube') === -1);

check('/tv without a nonce stamps none', injected.indexOf('nonce=') === -1, injected);

const overTls = rewriteBody('<html><body></body></html>', '/tv', 'https://www.youtube.com', 'n0nce+/=');
const overTlsTags = overTls.match(/<script[^>]*>/g) || [];
check('over our TLS the script comes from the page\'s own origin',
    overTls.indexOf('https://www.youtube.com/__tube/userScript.js') !== -1 && overTls.indexOf(ORIGIN) === -1, overTls);
check('over our TLS every injected tag carries the page\'s nonce',
    overTlsTags.length > 0 && overTlsTags.every((tag) => tag.indexOf(' nonce="n0nce+/="') !== -1), overTlsTags.join(' '));

const player = rewriteAttestation(
    'var x="https://jnn-pa.googleapis.com/$rpc/google.internal.waa.v1.Waa/GenerateIT";',
    'https://www.youtube.com/s/player/abc/tv-player-es6-tcl.js'
);
check('player routes jnn-pa through the service', player.indexOf(`${ORIGIN}/cors-bypass/https://jnn-pa.googleapis.com`) !== -1, player);

const wrapped = rewriteAttestation(
    '{"x":"{\\"interpreterUrl\\":{\\"privateDoNotAccessOrElseTrustedResourceUrlWrappedValue\\":'
        + '\\"//www.google.com/js/th/a.js\\"}}"}',
    'https://www.youtube.com/tv_config?action_get_config=true'
);
check('the BotGuard program URL is routed through the service',
    wrapped.indexOf(`${ORIGIN}/cors-bypass/https://www.google.com/js/th/a.js`) !== -1, wrapped);

const escaped = rewriteAttestation(
    '{"interpreterUrl":"\\/\\/www.google.com\\/js\\/th\\/a.js"}',
    'https://www.youtube.com/tv'
);
check('the escaped form is routed too', escaped.indexOf(`${ORIGIN}/cors-bypass/https:`) !== -1, escaped);

const cookies = rewriteSetCookie(['__Secure-3PSID=abc; Domain=.youtube.com; Secure; SameSite=None; Path=/']);
const attributes = cookies[0].split(/;\s*/).slice(1);
check('__Secure- cookie is renamed and de-secured',
    cookies[0].indexOf('__LocalSecure-3PSID') === 0
    && attributes.indexOf('Domain=localhost') !== -1
    && attributes.indexOf('Secure') === -1
    && attributes.indexOf('SameSite=None') === -1,
    cookies[0]);

check('the rename survives a round trip',
    restoreCookiePrefixes('__LocalSecure-3PSID=abc; __LocalHost-x=1') === '__Secure-3PSID=abc; __Host-x=1');

// YouTube's policy, near enough: a nonce, no connect-src at all. Cobalt reads the missing
// directive as "refuse", which is what stopped SponsorBlock reaching sponsor.ajay.app.
const youtubePolicy = "base-uri 'self';object-src 'none';script-src 'nonce-abc' 'strict-dynamic'";
const widened = withOurConnections(youtubePolicy);

check('the policy gains a connect-src it did not have',
    /(^|;)\s*connect-src \* data: blob: ws: wss:$/.test(widened), widened);
check('the nonce the injected script needs is left alone',
    widened.indexOf("'nonce-abc'") !== -1 && widened.indexOf("object-src 'none'") !== -1, widened);

check('an existing connect-src is widened rather than duplicated',
    withOurConnections("default-src 'self'; connect-src 'self' https://a.example; img-src *")
        === "default-src 'self'; connect-src * data: blob: ws: wss:; img-src *",
    withOurConnections("default-src 'self'; connect-src 'self' https://a.example; img-src *"));

check('a response with no policy is left without one',
    withOurConnections(undefined) === undefined && withOurConnections('') === '');

// Two policies are enforced together, so widening only one of them leaves the other refusing.
const both = withOurConnections("script-src 'nonce-a', require-trusted-types-for 'script'");
check('every policy in a combined header is widened',
    both.split(',').length === 2
    && both.split(',').every((one) => /connect-src \* data: blob: ws: wss:/.test(one)),
    both);

if (failures) {
    console.log(`${failures} check${failures === 1 ? '' : 's'} failed.`);
    process.exit(1);
}
console.log('all checks passed');
