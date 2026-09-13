import { TIMING } from './timing.js';
import { held } from './state.js';
import { elapsed } from './clock.js';
import { say } from './screen.js';

const GIVE_UP = `still not answering after ${TIMING.giveUp / 1000}s: if this screen stays, `
    + 'turn the TV off and on again; reinstall the app if it keeps happening';

const nag = (waited) => {
    if (held.seen) {
        held.seen = false;
        say('service', 'stopped answering', 'bad');
        return;
    }

    if (waited - held.nagged < TIMING.nag) return;

    held.nagged = waited;
    say('service', `not answering yet (${Math.round(waited / 1000)}s)`, 'warn');
};

export const silent = (again) => {
    const waited = elapsed();
    nag(waited);

    if (!held.gaveUp && waited > TIMING.giveUp) {
        held.gaveUp = true;
        say('service', GIVE_UP, 'bad');
    }

    setTimeout(again, TIMING.every);
};
