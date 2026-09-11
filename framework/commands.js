// Offers every command YouTube resolves to the registered interpreters in registration order.

import { findResolver } from './internals.js';

// An interpreter saying the command was not its business. Anything else is the answer YouTube gets.
const PASS = { pass: true };

const state = { patched: false, interpreters: [] };

const onCommand = (name, interpret) => {
    state.interpreters = state.interpreters.concat([{ name, interpret }]);
};

// `at` carries the unwrapped resolver so an interpreter can re-enter it.
const ask = (command, at) => state.interpreters.reduce((answer, entry) => {
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

    if (resolver.__tubePatched) {
        state.patched = true;
        return true;
    }

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
