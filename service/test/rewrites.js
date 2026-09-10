'use strict';

// Everything the proxy changes about a body or a header, which is text in and text out and so is
// the part of it that can be exercised without a set.
//
// Two of these are denials rather than degradations, which is why they are checked rather than
// read: Cobalt is served `default-src 'none'`, so a directive the policy does not name is refused
// outright — a missing connect-src fails every cross-origin request the userscript makes before it
// reaches the network, and a missing img-src refuses a substituted thumbnail while the fetch
// beside it succeeds.

const assert = require('assert');

process.env.TUBE_PROXY_HOST = 'tv.example';

const rewrites = require('../lib/rewrites.js');
const { flagOverrides } = require('../lib/knobs.js');

const results = [];
const check = (name, run) => {
    try {
        run();
        results.push(true);
        console.log(`PASS  ${name}`);
    } catch (failure) {
        results.push(false);
        console.log(`FAIL  ${name}\n      ${String(failure.message).split('\n').slice(0, 5).join('\n      ')}`);
    }
};

// -- the content security policy ------------------------------------------------------------

check('connect-src is widened where it is named', () => {
    const out = rewrites.withOurGrants("default-src 'none'; connect-src 'self' https://x.example");
    assert.ok(/connect-src \*/.test(out), out);
    assert.ok(out.indexOf('https://x.example') === -1, 'the narrow list survived');
});

check('and added where it is not, because default-src none refuses what it omits', () => {
    const out = rewrites.withOurGrants("default-src 'none'; script-src 'self'");
    assert.ok(/connect-src \*/.test(out), out);
    assert.ok(/img-src \*/.test(out), out);
});

// Two policies are enforced together, so widening one leaves the other refusing.
check('every policy in a combined header is widened, not just the first', () => {
    const out = rewrites.withOurGrants("default-src 'none',default-src 'none'");
    assert.strictEqual(out.split(',').length, 2, out);
    out.split(',').forEach((one) => assert.ok(/connect-src \*/.test(one), one));
});

check('an absent policy is left absent', () => {
    assert.strictEqual(rewrites.withOurGrants(''), '');
    assert.strictEqual(rewrites.withOurGrants(null), null);
});

check('the nonce is read back out of the policy the page was served', () => {
    assert.strictEqual(rewrites.nonceOf("script-src 'nonce-AbC-123_x' 'self'"), 'AbC-123_x');
    assert.strictEqual(rewrites.nonceOf("script-src 'self'"), null);
});

// -- the body -------------------------------------------------------------------------------

check('the innertube host override is added ahead of the client name', () => {
    const out = rewrites.overrideInnertubeHost('{"INNERTUBE_CONTEXT_CLIENT_NAME":7}');
    assert.ok(out.indexOf('INNERTUBE_HOST_OVERRIDE') !== -1, out);
    assert.ok(out.indexOf('"INNERTUBE_CONTEXT_CLIENT_NAME":7') !== -1, out);
});

check('the one SABR media url is sent back through the proxy', () => {
    const out = rewrites.rerouteAbr('{"serverAbrStreamingUrl":"https://rr1.googlevideo.com/x"}');
    assert.ok(out.indexOf('rr1.googlevideo.com') !== -1, out);
    assert.ok(out.indexOf('"serverAbrStreamingUrl":"https://rr1') === -1,
        'the url was left pointing straight at googlevideo');
});

// BotGuard's program url arrives inside a JSON string, so its quotes and slashes are escaped. A
// pattern expecting a bare quote matches nothing and fails silently.
check('the attestation program url is rewritten in its escaped form', () => {
    const escaped = '{\\"privateDoNotAccessOrElseTrustedResourceUrlWrappedValue\\":\\"\\/\\/x.example\\/p\\"}';
    const out = rewrites.rewriteAttestation(escaped, 'https://www.youtube.com/tv_config');
    assert.ok(out.indexOf('https:\\/\\/x.example') !== -1 || out.indexOf('https://x.example') !== -1, out);
});

// -- experiment flags -------------------------------------------------------------------------

check('a flag already in the blob is retuned in place', () => {
    flagOverrides.clear();
    flagOverrides.set('some_flag', 'false');

    const out = rewrites.retuneFlags('"serializedExperimentFlags\\":\\"some_flag\\u003dtrue\\u0026other\\u003d1');
    assert.ok(out.indexOf('some_flag\\u003dfalse') !== -1, out);
    assert.ok(out.indexOf('other\\u003d1') !== -1, 'the flags beside it were lost');
    flagOverrides.clear();
});

// An absent flag reads as off, so turning one on means adding it.
check('a flag not in the blob is added to the front of it', () => {
    flagOverrides.clear();
    flagOverrides.set('new_flag', 'true');

    const out = rewrites.retuneFlags('"serializedExperimentFlags\\":\\"other\\u003d1');
    assert.ok(out.indexOf('new_flag\\u003dtrue') !== -1, out);
    flagOverrides.clear();
});

// -- cookies -----------------------------------------------------------------------------------

// __Secure- and __Host- prefixed cookies are refused over plain HTTP, so they are renamed in both
// directions rather than dropped.
check('a prefixed cookie is renamed and its https-only attributes dropped', () => {
    const [out] = rewrites.rewriteSetCookie(
        ['__Secure-A=1; Domain=.youtube.com; Secure; SameSite=None; Path=/']
    );

    assert.ok(out.indexOf('__LocalSecure-A=1') === 0, out);
    assert.ok(!/;\s*Secure/i.test(out), out);
    assert.ok(!/SameSite=None/i.test(out), out);
    assert.ok(out.indexOf('Domain=localhost') !== -1, out);
});

check('and put back on the way up', () => {
    assert.strictEqual(rewrites.restoreCookiePrefixes('__LocalSecure-A=1; __LocalHost-B=2'),
        '__Secure-A=1; __Host-B=2');
});

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
