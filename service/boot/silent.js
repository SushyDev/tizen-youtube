import { service, diag } from './config.js';
import { TIMING } from './timing.js';
import { held } from './state.js';
import { elapsed } from './clock.js';
import { say } from './screen.js';
import { failureOf } from './failure.js';
import { lookElsewhere } from './elsewhere.js';
import { sayHelp } from './help.js';
import { phoneCanHelp, refresh } from './view.js';
import { sendReport } from './upload.js';
import { maybeReread } from './reread.js';
import { restartSilent } from './restart.js';
import { stopLaunching } from './launching.js';

const HOST = service.replace('http://', '');

const GIVE_UP_ALIVE = `still not answering after ${TIMING.giveUp / 1000}s: close Tube with a long press on Back and `
    + 'open it again; if this screen comes back, turn the TV off at the power button until the Samsung logo shows';

const GIVE_UP_DEAD = `still not answering after ${TIMING.giveUp / 1000}s: the TV has not started Tube's background `
    + 'service. Hold the power button until the Samsung logo shows, then open Tube';

// Named only when something answers, because the page is served by the same service.
const advise = () => {
    if (held.advised || !phoneCanHelp()) return;
    held.advised = true;

    say('tube', `scan the code on screen, or open ${diag} on a phone: it shows what failed and what to do`, 'note');
};

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

const silentFor = (waited) => {
    if (held.silentSince < 0) held.silentSince = waited;
    return waited - held.silentSince;
};

export const silent = (again, status, how) => {
    const waited = elapsed();

    if (held.seen) {
        held.seen = false;
        held.silentSince = -1;
        say('service', 'stopped answering', 'bad');
    }

    restartSilent();
    tell(failureOf(status, how));
    nag(waited);
    maybeReread();

    if (!held.silentStuck && (held.answeredOnce ? silentFor(waited) : waited) > TIMING.stuck) {
        held.silentStuck = true;
        stopLaunching('the service is not answering');
        sendReport(refresh);
    }

    if (!held.gaveUp && waited > TIMING.giveUp) {
        held.gaveUp = true;
        say('service', phoneCanHelp() ? GIVE_UP_ALIVE : GIVE_UP_DEAD, 'bad');
        sayHelp();
    }

    refresh();
    setTimeout(again, TIMING.every);
};
