'use strict';

// What the proxy is allowed to change about a response. The old parity test compared against a
// table of URL rewrites; that table is gone, because googlevideo and jnn-pa allow our origin and
// the player reaches them itself. All that is left is the script tag and the cookie names.

// Read at module load, so it has to be set before the proxy is required.
process.env.TUBE_PROXY_HOST = 'tv.example';

const { rewriteBody, rewriteAttestation, rewriteSetCookie, restoreCookiePrefixes } = require('../lib/proxy.js');

const ORIGIN = 'http://tv.example:8099';

let failures = 0;

function check(label, ok, detail) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  ${detail}`}`);
    if (!ok) failures += 1;
}

// Nothing of YouTube's own code is touched. These are the shapes the old table used to rewrite.
const UNTOUCHED = [
    ['absolute googlevideo', 'var u="https://r5---sn-abc.googlevideo.com/videoplayback?x=1";'],
    ['escaped googlevideo', 'var u="https:\\/\\/r5---sn-abc.googlevideo.com\\/videoplayback";'],
    ['protocol-relative gv', 'src="//r1---sn-xyz.googlevideo.com/foo"'],
    ['gstatic', 'a="https://www.gstatic.com/x";'],
    ['jnn-pa', 'f("https://jnn-pa.googleapis.com/v1/attest")'],
    ['origin allowlist', 'var o=new Set(["www.youtube.com","accounts.google.com"]);'],
    ['location href', 'var a=window.location.href;'],
    ['player scheme', 'this.scheme="https";this.host="x"']
];

UNTOUCHED.forEach(([label, source]) => {
    check(`${label} is left alone`, rewriteBody(source, '/watch') === source, rewriteBody(source, '/watch'));
});

const injected = rewriteBody('<html><body></body></html>', '/tv');
check('/tv gets the service\'s own script', injected.indexOf(`${ORIGIN}/__tube/userScript.js`) !== -1, injected);
check('/tv script goes inside the document', injected.indexOf('</body>') > injected.indexOf('__tube'), injected);
check('/tv has no CDN tag', injected.indexOf('jsdelivr') === -1);
check('/tv is injected into exactly once', injected.split('__tube/userScript.js').length === 2);

check('/tv_config is not injected into', rewriteBody('<html></html>', '/tv_config').indexOf('__tube') === -1);

const player = rewriteAttestation(
    'var x="https://jnn-pa.googleapis.com/$rpc/google.internal.waa.v1.Waa/GenerateIT";',
    'https://www.youtube.com/s/player/abc/tv-player-es6-tcl.js'
);
check('player routes jnn-pa through the service', player.indexOf(`${ORIGIN}/cors-bypass/https://jnn-pa.googleapis.com`) !== -1, player);

// The shape that actually ships, verified off the wire: it comes from /tv_config, wrapped in a
// TrustedResourceUrl, protocol-relative, and nested inside a JSON string so every quote around it
// is escaped. A pattern expecting a bare " matches nothing and fails silently, which cost three
// rounds of guessing — hence the literal escaping in this fixture.
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

if (failures) {
    console.log(`${failures} check${failures === 1 ? '' : 's'} failed.`);
    process.exit(1);
}
console.log('all checks passed');
