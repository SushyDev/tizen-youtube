// Every command YouTube resolves, offered to whoever asked for it.
//
// Two files used to wrap resolveCommand independently, latched by two different flags, each armed
// by its own waitFor. Whichever won the race wrapped the other, so which interpreter saw a command
// first depended on which poll fired first — and the one wrapped second could never see what the
// first had already answered. There is one patch now, and the order is the registration order.

import { findResolver } from './internals.js';

// An interpreter saying the command was not its business. Anything else is the answer YouTube gets.
const PASS = { pass: true };

const interpreters = [];
const state = { patched: false };

const onCommand = (name, interpret) => {
    interpreters.push({ name, interpret });
};

// `at` carries what an interpreter needs to re-enter YouTube's own resolver: skipWhosWatchingOnExit
// substitutes a command and calls the original, and it must get the true original rather than
// whatever else has wrapped it.
const ask = (command, at) => interpreters.reduce((answer, entry) => {
    if (answer !== PASS) return answer;

    try {
        return entry.interpret(command, at);
    } catch (failure) {
        console.error(`[command:${entry.name}] failed:`, failure);
        return PASS;
    }
}, PASS);

const claimCommands = () => {
    if (state.patched) return true;

    const resolver = findResolver();
    if (!resolver) return false;

    // Both of the old latches are still checked: a half-migrated tree must not double-wrap.
    if (resolver.__tubePatched || resolver.resolveCommand.isPatchedBySubtitleLocalization) return true;

    const original = resolver.resolveCommand;

    resolver.resolveCommand = function (command, context) {
        if (!command) return original.call(this, command, context);

        const answer = ask(command, { original, self: this, context });
        if (answer !== PASS) return answer;

        return original.call(this, command, context);
    };

    resolver.__tubePatched = true;
    state.patched = true;
    return true;
};

export { PASS, onCommand, claimCommands };
