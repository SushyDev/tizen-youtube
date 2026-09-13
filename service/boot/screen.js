import { TIMING } from './timing.js';
import { stamp } from './clock.js';
import { queue } from './outbox.js';

const part = (line, className, text) => {
    const span = document.createElement('span');
    if (className) span.className = className;
    span.textContent = text;
    line.appendChild(span);
};

const trim = (log) => Array.from(log.childNodes)
    .slice(0, Math.max(0, log.childNodes.length - TIMING.maxLines))
    .forEach((line) => log.removeChild(line));

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

    if (!fromService) queue(`${when}${facility}: ${message}`);
};
