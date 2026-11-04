import { onRequest } from '../../framework/index.js';

// Cobalt runs on UTC, and YouTube writes the times it sends (a premiere, a scheduled live) in the
// zone the request names, so they came out an hour or two early. The service knows the set's zone
// and leaves it on the page; served any other way, there is none and the request goes as it was.
const zone = () => (typeof window !== 'undefined' && window.__TUBE_ZONE__) || null;

const placed = (client, at) => {
    const named = at.timeZone ? { timeZone: at.timeZone } : {};
    return Object.assign({}, client, { utcOffsetMinutes: at.utcOffsetMinutes }, named);
};

const inZone = (body) => {
    const at = zone();
    const client = body.context && body.context.client;
    if (!at || !client || typeof at.utcOffsetMinutes !== 'number') return body;

    if (client.utcOffsetMinutes === at.utcOffsetMinutes && (!at.timeZone || client.timeZone === at.timeZone)) return body;

    return Object.assign({}, body, { context: Object.assign({}, body.context, { client: placed(client, at) }) });
};

onRequest('time zone', ['context'], inZone);

export { inZone };
