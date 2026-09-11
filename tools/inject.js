'use strict';

function injectTokens(code, tokens) {
    const applied = [];

    for (const token in tokens) {
        if (!Object.prototype.hasOwnProperty.call(tokens, token)) continue;

        const value = tokens[token];
        if (typeof value !== 'string' || !value) {
            throw new Error(`No value supplied for build token ${token}.`);
        }

        const before = code;
        code = code.split(token).join(value);

        if (code === before) {
            throw new Error(
                `Build token ${token} was never found in the bundle.\n` +
                `  The source that should contain it may have changed.`
            );
        }
        applied.push(token);
    }

    for (const token in tokens) {
        if (code.indexOf(token) !== -1) {
            throw new Error(`Build token ${token} still present after substitution.`);
        }
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

// rollup's `replace` plugin substitutes silently: a token whose source moved is simply not
// replaced, and ships as the literal string. injectTokens has always thrown on that; this gives
// the userscript pipeline the same check without forcing the two to share a mechanism.
function assertNoTokens(code, where) {
    const unique = BUILD_TOKENS.filter((token) => code.indexOf(token) !== -1);
    if (!unique.length) return;
    throw Object.assign(new Error(
        `${where} still contains ${unique.length === 1 ? 'a build token' : 'build tokens'}: ${unique.join(', ')}.\n` +
        '  It was never substituted, so it would ship as that literal string.'
    ), { isFriendly: true });
}

module.exports = { injectTokens, assertNoTokens };
