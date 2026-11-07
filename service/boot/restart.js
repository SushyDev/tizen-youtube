import { service } from './config.js';
import { TIMING } from './timing.js';
import { held } from './state.js';
import { elapsed } from './clock.js';
import { say } from './screen.js';
import { get } from './request.js';
import { refresh } from './view.js';

const since = () => elapsed() - held.restarting;

export const restartService = () => {
    if (!held.seen || held.restarting) return;

    held.restarting = Math.max(1, elapsed());
    held.restartGap = false;
    say('tube', 'restarting the service', 'warn');
    get(`${held.serving || service}/__tube/restart-service`, () => undefined);
    refresh();
};

// The service is back once it answered after a gap; without a gap it never went away.
export const restartHeard = () => {
    if (!held.restarting) return;

    if (held.restartGap) {
        held.restarting = 0;
        say('service', 'back after the restart', 'ok');
    } else if (since() > TIMING.restartWait) {
        held.restarting = 0;
        say('service', 'did not restart: the same run is still answering', 'warn');
    }
};

export const restartSilent = () => {
    if (!held.restarting) return;

    held.restartGap = true;
    if (since() <= TIMING.restartWait) return;

    held.restarting = 0;
    say('service', `did not come back within ${TIMING.restartWait / 1000}s of the restart`, 'bad');
};
