import { probeUrl } from './config.js';
import { held } from './state.js';
import { elapsed } from './clock.js';
import { get } from './request.js';

const where = () => (held.serving ? `${held.serving}/__tube/ping` : probeUrl);

export const probe = (reachable, unreachable) => get(`${where()}?t=${Math.round(elapsed())}`,
    (status) => (status === 204 ? reachable() : unreachable()));
