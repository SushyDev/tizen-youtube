import { TIMING } from './timing.js';
import { held } from './state.js';
import { say } from './screen.js';
import { flush } from './outbox.js';

const GIVE_UP = 'youtube still does not answer through the service: close the app and open it again; '
    + 'reinstall it if this keeps happening';

// A new certificate is trusted only after a restart, so the service is asked for one, once.
const askForRestart = () => {
    if (held.restartAsked) return;

    held.restartAsked = true;
    say('tube', 'restarting the app, so it trusts the new certificate', 'warn');
    flush('&restart=1');
};

export const blocked = (again) => {
    held.probed += 1;

    if (held.probed === 1) say('tube', 'youtube does not answer through the service yet', 'warn');
    if (held.probed === TIMING.restartAfter) askForRestart();
    if (held.probed === TIMING.probeGiveUp) say('tube', GIVE_UP, 'bad');

    setTimeout(again, TIMING.poll);
};
