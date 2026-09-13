import { TIMING } from './timing.js';
import { held } from './state.js';
import { bootUrl } from './urls.js';
import { send } from './request.js';

// The screen's own lines, waiting to reach the service's log.
export const queue = (line) => {
    held.unsent = held.unsent.concat([line]).slice(-TIMING.keepUnsent);
};

export const outgoing = () => held.unsent.slice(0, TIMING.sendAtOnce);

export const sent = (count) => {
    held.unsent = held.unsent.slice(count);
};

// Sent without waiting: the page may be leaving.
export const flush = (extra, base) => {
    if (!held.unsent.length && !extra) return;

    send(`${bootUrl(outgoing(), base)}${extra || ''}`);
    held.unsent = [];
};
