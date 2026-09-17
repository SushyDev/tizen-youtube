import { service, diag } from './config.js';
import { TIMING } from './timing.js';
import { held } from './state.js';
import { elapsed } from './clock.js';
import { say } from './screen.js';
import { failureOf } from './failure.js';
import { lookElsewhere } from './elsewhere.js';
import { sayHelp } from './help.js';

const HOST = service.replace('http://', '');

const GIVE_UP = `still not answering after ${TIMING.giveUp / 1000}s: if this screen stays, `
    + 'turn the TV off and on again; reinstall the app if it keeps happening';

// Named at the first resistance rather than held back for the give-up a minute later: a screen that
// only counts seconds gives a viewer no reason to think it is their move.
//
// The page is worth naming even though the service is what is failing: it is asked for over the
// network from a phone, which is not the path the container just failed on, so it answers in every
// case except a service that is wholly down — and that case says so on the line above.
const advise = () => {
    if (held.advised) return;
    held.advised = true;

    say('tube', `open ${diag} on a phone to see what, and what to do`, 'note');
};

// Said at once, and again whenever the way it fails changes.
const tell = (failure) => {
    if (failure.kind === held.failure) return;

    held.failure = failure.kind;
    say('service', `${HOST}: ${failure.words}`, 'warn');
    advise();
    lookElsewhere();
};

const nag = (waited) => {
    if (waited - held.nagged < TIMING.nag) return;

    // Nothing can be asked of a service that is not answering, so the check waits for the first reply.
    held.stuck = true;
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
        sayHelp();
    }

    setTimeout(again, TIMING.every);
};
