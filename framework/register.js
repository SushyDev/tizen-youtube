// Runs registered features in phase order.

import { report, warn } from './journal.js';
import { watchPage } from './pageErrors.js';

// network first, because it takes over fetch and XHR before anything asks the network for anything.
const PHASES = ['network', 'settings', 'ui', 'intercept'];

const state = { booted: false, features: [] };

const register = (name, phase, start) => {
    if (PHASES.indexOf(phase) === -1) {
        report('register', `${name} asked for a phase that does not exist: ${phase}`);
        return;
    }

    // Registering after boot() is a mistake that otherwise shows up as a feature that simply never
    // happens, with nothing anywhere to say why.
    if (state.booted) {
        warn('register', `${name} arrived after boot; it will not run`);
        return;
    }

    state.features = state.features.concat([{ name, phase, start }]);
};

// One feature failing must not take the rest of the app down with it: on a set we have not seen,
// half a userscript beats none of it.
const runPhase = (phase) => state.features
    .filter((feature) => feature.phase === phase)
    .forEach((feature) => {
        try {
            feature.start();
        } catch (failure) {
            report(feature.name, 'did not start', failure);
        }
    });

const boot = () => {
    if (state.booted) return;

    watchPage();
    PHASES.forEach(runPhase);
    state.booted = true;
};

const booted = () => state.booted;

export { PHASES, register, boot, booted };
