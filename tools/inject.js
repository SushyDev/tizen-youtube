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

module.exports = { injectTokens };
