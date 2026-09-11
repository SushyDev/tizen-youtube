'use strict';

// Sends a request upstream and repeats it once when the connection, the header size or a truncated
// body was the problem, never for a streamed body.

const fetch = require('node-fetch');
const http = require('http');
const https = require('https');

const postmortem = require('./postmortem.js');
const bigheaders = require('./bigheaders.js');

// A booting page opens about thirty requests at once, so the pool must be wide enough that a few
// stalled sockets cannot queue the rest.
const MOST_SOCKETS = 64;

// No socket timeout: a paused SABR stream is an idle socket, and a timeout would cut playback.
const AGENT_OPTIONS = { keepAlive: true, keepAliveMsecs: 15000, maxSockets: MOST_SOCKETS };
const httpsAgent = new https.Agent(AGENT_OPTIONS);
const httpAgent = new http.Agent(AGENT_OPTIONS);
const agentFor = (url) => (String(url).indexOf('https:') === 0 ? httpsAgent : httpAgent);

// Only the wait for headers is bounded, so a stalled request frees its socket and a streaming body
// is never cut.
const HEADERS_DEADLINE = 20000;

const RETRIABLE = ['ECONNRESET', 'EPIPE', 'ETIMEDOUT'];

const BODIED = ['POST', 'PUT', 'PATCH'];

const isRepeatable = (req) => !!req && BODIED.indexOf(req.method) === -1;

const isRetriable = (error) => !!error
    && (RETRIABLE.indexOf(error.code) !== -1 || /socket hang up|premature close/i.test(error.message || ''));

// Node 12 has no AbortController, and node-fetch accepts any signal whose constructor is named
// AbortSignal.
const SIGNAL = { constructor: { name: 'AbortSignal' } };

const untilHeaders = (make) => {
    const held = { listeners: [] };
    const signal = Object.assign(Object.create(SIGNAL), {
        aborted: false,
        addEventListener: (_, listener) => { held.listeners = held.listeners.concat(listener); },
        removeEventListener: (_, listener) => {
            held.listeners = held.listeners.filter((other) => other !== listener);
        }
    });
    const timer = setTimeout(() => {
        signal.aborted = true;
        held.listeners.forEach((listener) => listener());
    }, HEADERS_DEADLINE);
    const stop = (answer) => { clearTimeout(timer); return answer; };

    return make(signal).then(stop, (error) => { stop(); throw error; });
};

const send = (url, req, headers, fresh) => {
    const body = isRepeatable(req) ? undefined : req;

    const options = {
        method: req.method,
        headers,
        body,
        redirect: 'manual',
        agent: fresh ? undefined : agentFor(url)
    };

    const attempt = (changed) => untilHeaders((signal) =>
        fetch(url, Object.assign({}, options, changed, { signal })));

    return attempt().catch((error) => {
        if (bigheaders.isHeaderOverflow(error) && !body && url.indexOf('https:') === 0) {
            postmortem.note('upstream', `header overflow on ${url.slice(0, 80)} — retrying over http2`);
            return bigheaders.fetchOverHttp2(url, { method: req.method, headers });
        }

        // A streamed body cannot be sent twice.
        if (!isRetriable(error) || body) throw error;

        postmortem.note('upstream', `${postmortem.describe(error)} on ${url.slice(0, 80)}`
            + ' — retrying on a fresh connection');

        return attempt({ agent: undefined });
    });
};

const textOf = (response) => response.text().then((text) => ({ response, text }));

// A body cut off by a dead socket is fetched once more, on a fresh connection, instead of answering
// the page with a 500.
const readText = (response, url, req, headers) => textOf(response).catch((error) => {
    if (!isRetriable(error) || !isRepeatable(req)) throw error;

    postmortem.note('upstream', `${postmortem.describe(error)} reading ${url.slice(0, 80)}`
        + ' — asking again');

    return send(url, req, headers, true).then(textOf);
});

module.exports = { send, readText };
