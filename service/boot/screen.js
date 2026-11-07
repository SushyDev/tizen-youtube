import { TIMING } from './timing.js';
import { elapsed, stamp } from './clock.js';
import { queue } from './outbox.js';
import { held } from './state.js';
import { redact } from './redact.js';

const part = (line, className, text) => {
    const span = document.createElement('span');
    if (className) span.className = className;
    span.textContent = text;
    line.appendChild(span);
};

const trim = (log) => Array.from(log.childNodes)
    .slice(0, Math.max(0, log.childNodes.length - TIMING.maxLines))
    .forEach((line) => log.removeChild(line));

// Kept whole, beyond what fits on screen, for a report sent from here.
const keep = (facility, message) => {
    held.lines = held.lines.concat([{ at: Math.round(elapsed()), what: facility, text: redact(message) }])
        .slice(-TIMING.keptForReport);
};

// fromService: already in the service's log.
export const say = (facility, message, tone, fromService) => {
    const when = stamp();
    const line = document.createElement('div');
    const log = document.getElementById('log');

    part(line, 't', when);
    part(line, 's', `${facility}: `);
    part(line, tone || '', message);

    log.appendChild(line);
    trim(log);
    keep(facility, message);

    if (!fromService) queue(`${when}${facility}: ${message}`);
};
