// What runs, and when.
//
// This replaces sixteen side-effecting imports in core.js whose order was the boot order. Nothing
// said so: reordering that list silently reordered the writer pipeline and could start the JSON
// interception before the handlers that wanted it had registered. Here the order is a list of
// names, and a feature says which one it belongs to.

// network first, because it takes over fetch and XHR before anything asks the network for
// anything. paint second, because the theme has to be up before the frame it would otherwise
// flash through. intercept last, because taking over JSON.parse seals registration.
const PHASES = ['network', 'paint', 'settings', 'feed', 'player', 'ui', 'intercept'];

const features = [];
const state = { booted: false };

const register = (name, phase, start) => {
    if (PHASES.indexOf(phase) === -1) {
        console.error(`[register] ${name} asked for a phase that does not exist: ${phase}`);
        return;
    }

    // Registering after boot() is a mistake that otherwise shows up as a feature that simply never
    // happens, with nothing anywhere to say why.
    if (state.booted) {
        console.warn(`[register] ${name} arrived after boot; it will not run`);
        return;
    }

    features.push({ name, phase, start });
};

// One feature failing must not take the rest of the app down with it: on a set we have not seen,
// half a userscript beats none of it.
const runPhase = (phase) => features
    .filter((feature) => feature.phase === phase)
    .forEach((feature) => {
        try {
            feature.start();
        } catch (failure) {
            console.error(`[${feature.name}] did not start:`, failure);
        }
    });

// Must be called synchronously at the end of the bundle. preferredVideoQuality seeds localStorage
// before kabuki's async script reads it, which works only because our script is parser-inserted;
// waiting for DOMContentLoaded would move the quality decision to after the first frame.
const boot = () => {
    if (state.booted) return;

    PHASES.forEach(runPhase);
    state.booted = true;
};

const booted = () => state.booted;

export { PHASES, register, boot, booted };
