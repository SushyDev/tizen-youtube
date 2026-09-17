import { service } from './config.js';
import { held } from './state.js';
import { elapsed } from './clock.js';

export const bootUrl = (sending, base) => `${base || service}/__tube/boot?since=${held.since}`
    + (held.seen ? '' : `&waited=${Math.round(elapsed())}`)
    + (held.stuck && !held.diagnosed ? '&stuck=1' : '')
    + (sending.length ? `&said=${encodeURIComponent(JSON.stringify(sending))}` : '');
