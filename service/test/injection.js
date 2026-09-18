'use strict';

// Read at module load, so it has to be set before the proxy is required.
process.env.TUBE_PROXY_HOST = 'tv.example';

const {
    rewriteBody, rewriteAttestation, rewriteSetCookie, restoreCookiePrefixes
} = require('../lib/rewrites.js');

const ORIGIN = 'http://tv.example:8099';

const tally = { failures: 0, total: 0 };

function check(label, ok, detail) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  ${detail}`}`);
    tally.total += 1;
    if (!ok) tally.failures += 1;
}

const UNTOUCHED = [
    ['absolute googlevideo', 'const u="https://r5---sn-abc.googlevideo.com/videoplayback?x=1";'],
    ['escaped googlevideo', 'const u="https:\\/\\/r5---sn-abc.googlevideo.com\\/videoplayback";'],
    ['protocol-relative gv', 'src="//r1---sn-xyz.googlevideo.com/foo"'],
    ['gstatic', 'a="https://www.gstatic.com/x";'],
    ['origin allowlist', 'const o=new Set(["www.youtube.com","accounts.google.com"]);'],
    ['location href', 'const a=window.location.href;'],
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

// The page is served as ourselves over plain HTTP, so there is no policy nonce to carry.
check('no injected tag carries a nonce', injected.indexOf('nonce=') === -1, injected);

const player = rewriteAttestation('const x="https://jnn-pa.googleapis.com/$rpc/google.internal.waa.v1.Waa/GenerateIT";');
check('jnn-pa is routed through the service', player.indexOf(`${ORIGIN}/cors-bypass/https://jnn-pa.googleapis.com`) !== -1, player);

const wrapped = rewriteAttestation(
    '{"x":"{\\"interpreterUrl\\":{\\"privateDoNotAccessOrElseTrustedResourceUrlWrappedValue\\":'
        + '\\"//www.google.com/js/th/a.js\\"}}"}'
);
check('the BotGuard program URL is routed through the service',
    wrapped.indexOf(`${ORIGIN}/cors-bypass/https://www.google.com/js/th/a.js`) !== -1, wrapped);

const ESCAPED_ORIGIN = ORIGIN.replace(/\//g, '\\/');
const escaped = rewriteAttestation('{"interpreterUrl":"\\/\\/www.google.com\\/js\\/th\\/a.js"}');
check('the escaped form is routed in its own escaping',
    escaped.indexOf(`${ESCAPED_ORIGIN}\\/cors-bypass\\/https:\\/\\/www.google.com\\/js\\/th\\/a.js`) !== -1, escaped);
check('and stays valid JSON', (() => { try { return !!JSON.parse(escaped); } catch (e) { return false; } })(), escaped);

const renamed = rewriteAttestation('{"programSource":"//www.google.com/js/th/b.js","rpc":"https://jnn-pa.googleapis.com"}');
check('a field YouTube renames is still routed', renamed.split(`${ORIGIN}/cors-bypass/https://`).length === 3, renamed);

const literal = rewriteAttestation('const r=/^https:\\/\\/jnn-pa.googleapis.com\\//;');
check('a regex literal naming jnn-pa still parses', (() => {
    try { return !!new (require('vm').Script)(literal); } catch (e) { return false; }
})(), literal);

const elsewhere = 'a="https://www.google.com/search";b="//www.google.com/recaptcha/api.js"';
check('other google.com URLs are left alone', rewriteAttestation(elsewhere) === elsewhere, rewriteAttestation(elsewhere));

const cookies = rewriteSetCookie(['__Secure-3PSID=abc; Domain=.youtube.com; Secure; SameSite=None; Path=/']);
const attributes = cookies[0].split(/;\s*/).slice(1);
check('__Secure- cookie is renamed and de-secured',
    cookies[0].indexOf('__LocalSecure-3PSID') === 0
    && attributes.indexOf('Domain=tv.example') !== -1
    && attributes.indexOf('Secure') === -1
    && attributes.indexOf('SameSite=None') === -1,
    cookies[0]);

check('the rename survives a round trip',
    restoreCookiePrefixes('__LocalSecure-3PSID=abc; __LocalHost-x=1') === '__Secure-3PSID=abc; __Host-x=1');

// The page's reporter is injected from its own source, so it has to run as well as parse.
const pageScripts = (rewriteBody('<html><body></body></html>', '/tv').match(/<script>[^<]*<\/script>/g) || [])
    .map((tag) => tag.replace(/<\/?script>/g, ''));
const beacons = [];
const listeners = {};
const page = {
    fetch: () => undefined,
    addEventListener: (type, handle) => { listeners[type] = handle; },
    Image: function Image() { Object.defineProperty(this, 'src', { set: (to) => beacons.push(decodeURIComponent(to)) }); }
};

pageScripts.forEach((code) => require('vm').runInNewContext(code, { window: page }));
page.onerror('boom', 'https://www.youtube.com/tv', 3, 7);
listeners.unhandledrejection({ reason: { message: 'quota' } });

check('the page reporter sends the page\'s errors to the journal',
    beacons.indexOf(`${ORIGIN}/__tube/journal?m=boom @ https://www.youtube.com/tv:3:7`) !== -1, beacons.join(' | '));
check('and its rejections', beacons.some((to) => /m=rejection: quota$/.test(to)), beacons.join(' | '));
check('and says whether the userscript ran', beacons.some((to) => /m=booted \d\d:\d\d:\d\d: fetch untouched$/.test(to)),
    beacons.join(' | '));

console.log(`\n${tally.total - tally.failures}/${tally.total} checks passed.`);
process.exit(tally.failures ? 1 : 0);
