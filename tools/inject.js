'use strict';

// A build token that is never substituted throws rather than shipping as a literal.

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

// Named rather than matched by pattern: the page carries runtime globals of the same shape, such
// as __TUBE_NATIVE_PROXY_PATCHES__, which is meant to survive into the bundle.
const BUILD_TOKENS = [
    '__TUBE_VERSION__', '__TUBE_COMMIT__', '__TUBE_TREE__',
    '__TUBE_DEV_TOOLS__', '__TUBE_DEV_TOKEN__', '__TUBE_CHII__'
];

// rollup's `replace` plugin substitutes silently, so the userscript pipeline is checked here.
function assertNoTokens(code, where) {
    const unique = BUILD_TOKENS.filter((token) => code.indexOf(token) !== -1);
    if (!unique.length) return;
    throw Object.assign(new Error(
        `${where} still contains ${unique.length === 1 ? 'a build token' : 'build tokens'}: ${unique.join(', ')}.\n` +
        '  It was never substituted, so it would ship as that literal string.'
    ), { isFriendly: true });
}

module.exports = { injectTokens, assertNoTokens };
