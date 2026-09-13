import { service } from './config.js';
import { held } from './state.js';
import { elapsed } from './clock.js';

// The ask, with the wait until first contact and the screen's own lines; to another address if given.
export const bootUrl = (sending, base) => `${base || service}/__tube/boot?since=${held.since}`
    + (held.seen ? '' : `&waited=${Math.round(elapsed())}`)
    + (sending.length ? `&said=${encodeURIComponent(JSON.stringify(sending))}` : '');
