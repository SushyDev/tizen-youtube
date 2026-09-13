import { TIMING } from './timing.js';

// Answers once: with the reply, or status 0 when it times out or cannot be sent.
export const get = (url, done) => {
    const request = new XMLHttpRequest();
    const settled = { yes: false };

    const finish = (status, text) => {
        if (settled.yes) return;
        settled.yes = true;
        done(status, text);
    };

    request.onreadystatechange = () => {
        if (request.readyState === 4) finish(request.status, request.responseText);
    };

    setTimeout(() => {
        if (settled.yes) return;
        try { request.abort(); } catch (e) { /* already gone */ }
        finish(0, '');
    }, TIMING.askTimeout);

    request.open('GET', url, true);
    try { request.send(); } catch (e) { finish(0, ''); }
};

// Fire and forget.
export const send = (url) => {
    try {
        const request = new XMLHttpRequest();
        request.open('GET', url, true);
        request.send();
    } catch (e) { /* the page is leaving */ }
};
