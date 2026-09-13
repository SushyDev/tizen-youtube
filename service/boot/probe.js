import { probeUrl } from './config.js';
import { elapsed } from './clock.js';
import { get } from './request.js';

// YouTube, asked through Cobalt's proxy and our certificate, as the page will be.
export const probe = (reachable, unreachable) => get(`${probeUrl}?t=${Math.round(elapsed())}`,
    (status) => (status === 204 ? reachable() : unreachable()));
