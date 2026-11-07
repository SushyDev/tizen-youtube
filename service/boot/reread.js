import { TIMING } from './timing.js';
import { held } from './state.js';
import { sinceLoad, carryOver } from './clock.js';
import { say } from './screen.js';
import { flush } from './outbox.js';

const COUNT = 'tube.boot.rereads';

const recent = () => {
    try {
        const at = JSON.parse(window.localStorage.getItem(COUNT) || '[]');
        return Array.isArray(at) ? at.filter((one) => Date.now() - one < TIMING.rereadWindow) : null;
    } catch (e) {
        return null;
    }
};

// The service rewrites this page when its address changes, so a page waiting on an old one reads itself again.
export const maybeReread = () => {
    if (held.answeredOnce || held.serving || held.failure === '' || held.elsewhere.indexOf('none') !== 0) return;
    if (sinceLoad() < TIMING.reread) return;

    const done = recent();
    if (!done || done.length >= TIMING.rereadsPer) return;

    try {
        window.localStorage.setItem(COUNT, JSON.stringify(done.concat([Date.now()])));
    } catch (e) {
        return;
    }

    if (!carryOver()) return;

    say('tube', 'reading this page again, in case the service moved to a new address', 'warn');
    flush();
    window.location.replace(window.location.href);
};
