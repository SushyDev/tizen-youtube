import { service, alternates } from './config.js';
import { TIMING } from './timing.js';
import { held } from './state.js';
import { elapsed } from './clock.js';
import { say } from './screen.js';
import { get } from './request.js';
import { flush } from './outbox.js';

const host = (url) => url.replace('http://', '');

const answeredAt = (answered) => {
    say('service', `answers at ${answered.map(host).join(', ')} but not at ${host(service)}: `
        + `this TV blocks ${host(service)}, so YouTube cannot reach the proxy either`, 'bad');

    // The service's log gets the screen's lines through the address that works.
    flush('', answered[0]);
};

// A service still starting is silent everywhere too, so silence is only a verdict once it lasts.
const nowhere = (late) => say('service', `nor at ${alternates.map(host).join(', ')}`
    + (late ? ': the service is not running, or is stuck' : ' yet'), 'warn');

const settle = (answered) => {
    held.looking = false;

    const late = elapsed() > TIMING.nag * 2;
    const found = answered.length ? answered.join(' ') : `none${late ? ' late' : ''}`;
    if (held.seen || found === held.elsewhere) return;

    held.elsewhere = found;
    return answered.length ? answeredAt(answered) : nowhere(late);
};

// Asks the service's other addresses, to tell a blocked address from a dead service.
export const lookElsewhere = () => {
    if (held.looking || !alternates.length) return;
    held.looking = true;

    const round = { left: alternates.length, answered: [] };

    alternates.forEach((alternate) => get(`${alternate}/__tube/ping`, (status) => {
        if (status === 204) round.answered = round.answered.concat([alternate]);

        round.left -= 1;
        if (!round.left) settle(round.answered);
    }));
};
