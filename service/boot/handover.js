import { target } from './config.js';
import { TIMING } from './timing.js';
import { held } from './state.js';
import { say } from './screen.js';
import { flush } from './outbox.js';
import { refresh } from './view.js';

const to = () => (held.serving ? `${held.serving}/tv` : target);

const hash = () => String(window.location.hash || '').replace(/^#?launcher$/, '');

// Still running this long after leaving means the page never arrived, and this one can still help.
const stillHere = () => {
    if (!held.handed) return;

    held.slowHandover = true;
    say('tube', `youtube has not loaded ${TIMING.slowHandover / 1000}s after the handover`, 'warn');
    flush();
    refresh();
};

const go = () => {
    if (!held.handed) return;

    held.left = true;
    setTimeout(stillHere, TIMING.slowHandover);

    // The query carries Cobalt's device sign-in.
    window.location.replace(`${to()}${window.location.search}${hash()}`);
};

export const handOver = () => {
    if (held.handed) return;

    held.handed = true;
    refresh();

    if (held.through) say('tube', 'youtube answers through the service', 'ok');
    say('tube', `handing over to ${to()}`, 'ok');
    flush();

    setTimeout(go, TIMING.linger);
};

// Within the linger the page has not gone yet; after it, loading this page again is what stops the one on its way.
export const cancelHandOver = () => {
    held.handed = false;
    say('tube', 'handover stopped', 'warn');

    if (!held.left) return refresh();

    flush();
    window.location.hash = 'launcher';
    return window.location.reload ? window.location.reload() : undefined;
};
