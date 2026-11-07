import { TIMING } from './timing.js';
import { elapsed } from './clock.js';

const ask = (method, url, body, done, timeout) => {
    const request = new XMLHttpRequest();
    const began = elapsed();
    const settled = { yes: false };

    const finish = (status, text, timedOut) => {
        if (settled.yes) return;
        settled.yes = true;
        done(status, text, { ms: Math.round(elapsed() - began), timedOut: !!timedOut });
    };

    request.onreadystatechange = () => {
        if (request.readyState === 4) finish(request.status, request.responseText);
    };

    // Settled before the abort, whose own readystatechange would read as a refusal.
    setTimeout(() => {
        if (settled.yes) return;
        finish(0, '', true);
        try { request.abort(); } catch (e) { /* already gone */ }
    }, timeout || TIMING.askTimeout);

    request.open(method, url, true);
    if (body) request.setRequestHeader('Content-Type', 'application/json');
    try { request.send(body || null); } catch (e) { finish(0, ''); }
};

export const get = (url, done) => ask('GET', url, null, done);

export const post = (url, body, done) => ask('POST', url, body, done, 15000);

export const send = (url) => {
    try {
        const request = new XMLHttpRequest();
        request.open('GET', url, true);
        request.send();
    } catch (e) { /* the page is leaving */ }
};
