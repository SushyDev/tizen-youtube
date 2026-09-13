import { service } from './config.js';
import { TIMING } from './timing.js';
import { held } from './state.js';
import { elapsed } from './clock.js';
import { say } from './screen.js';
import { failureOf } from './failure.js';
import { lookElsewhere } from './elsewhere.js';

const HOST = service.replace('http://', '');

const GIVE_UP = `still not answering after ${TIMING.giveUp / 1000}s: if this screen stays, `
    + 'turn the TV off and on again; reinstall the app if it keeps happening';

// Said at once, and again whenever the way it fails changes.
const tell = (failure) => {
    if (failure.kind === held.failure) return;

    held.failure = failure.kind;
    say('service', `${HOST}: ${failure.words}`, 'warn');
    lookElsewhere();
};

const nag = (waited) => {
    if (waited - held.nagged < TIMING.nag) return;

    held.nagged = waited;
    say('service', `not answering yet (${Math.round(waited / 1000)}s)`, 'warn');
    lookElsewhere();
};

export const silent = (again, status, how) => {
    const waited = elapsed();

    if (held.seen) {
        held.seen = false;
        say('service', 'stopped answering', 'bad');
    }

    tell(failureOf(status, how));
    nag(waited);

    if (!held.gaveUp && waited > TIMING.giveUp) {
        held.gaveUp = true;
        say('service', GIVE_UP, 'bad');
    }

    setTimeout(again, TIMING.every);
};
