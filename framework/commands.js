// Offers every command YouTube resolves to the registered interpreters in registration order.

import { findResolver } from './internals.js';
import { report, warn } from './journal.js';
import { booted } from './register.js';

// An interpreter saying the command was not its business. Anything else is the answer YouTube gets.
const PASS = { pass: true };

const state = { patched: false, interpreters: [] };

// Precedence is registration order, so one arriving late is not only late: it is last.
const onCommand = (name, interpret) => {
    if (booted()) warn('command', `${name} registered after boot; it answers last, behind every interpreter`);

    state.interpreters = state.interpreters.concat([{ name, interpret }]);
};

// `at` carries the unwrapped resolver so an interpreter can re-enter it.
const ask = (command, at) => state.interpreters.reduce((answer, entry) => {
    if (answer !== PASS) return answer;

    try {
        return entry.interpret(command, at);
    } catch (failure) {
        report(`command:${entry.name}`, 'failed', failure);
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
