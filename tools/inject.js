'use strict';

// A token whose source moved is simply not found, and would ship as the literal string. Both
// halves of this file exist to make that loud: substitution throws when a token is absent, and
// assertNoTokens throws when one survives a pipeline that substitutes silently.

function substitute(code, token, value) {
    if (typeof value !== 'string' || !value) {
        throw new Error(`No value supplied for build token ${token}.`);
    }

    const next = code.split(token).join(value);

    if (next === code) {
        throw new Error(
            `Build token ${token} was never found in the bundle.\n` +
            `  The source that should contain it may have changed.`
        );
    }

    return next;
}

function injectTokens(source, tokens) {
    const applied = Object.keys(tokens);
    const code = applied.reduce((carried, token) => substitute(carried, token, tokens[token]), source);
    const survivors = applied.filter((token) => code.indexOf(token) !== -1);

    if (survivors.length) {
        throw new Error(`Build token ${survivors[0]} still present after substitution.`);
    }

    return { code, applied };
}

// Every name the build substitutes. Named rather than matched by pattern, because the page also
// carries runtime globals of the same shape — __TUBE_NATIVE_PROXY_PATCHES__ is set by the proxy
// and is meant to survive into the bundle.
const BUILD_TOKENS = [
    '__TUBE_ORIGIN__', '__TUBE_VERSION__', '__TUBE_COMMIT__', '__TUBE_TREE__',
    '__TUBE_DEV_TOOLS__', '__TUBE_DEV_TOKEN__', '__TUBE_CHII__'
];

// rollup's `replace` plugin substitutes silently, which is what this catches for the userscript
// pipeline without forcing the two to share a mechanism.
function assertNoTokens(code, where) {
    const unique = BUILD_TOKENS.filter((token) => code.indexOf(token) !== -1);
    if (!unique.length) return;
    throw Object.assign(new Error(
        `${where} still contains ${unique.length === 1 ? 'a build token' : 'build tokens'}: ${unique.join(', ')}.\n` +
        '  It was never substituted, so it would ship as that literal string.'
    ), { isFriendly: true });
}

module.exports = { injectTokens, assertNoTokens };
