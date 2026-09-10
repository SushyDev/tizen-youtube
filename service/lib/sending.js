'use strict';

// Sends upstream, retrying once on a dead pooled socket or a header overflow.

const fetch = require('node-fetch');
const http = require('http');
const https = require('https');

const postmortem = require('./postmortem.js');
const bigheaders = require('./bigheaders.js');

// A wedged socket must cost its own request and no others. This was eight, which a page opening
// thirty requests at once already queues behind — and since nothing below reclaims a socket, eight
// stalls took the whole proxy down until the service was restarted. Measured on the set while it
// was in that state: youtube.com answered the television directly in 123ms, every request through
// here timed out, and restarting the service fixed it and nothing else did.
const MOST_SOCKETS = 64;

// No socket timeout, and there must not be one. A SABR answer is one long-lived response the
// player reads from for as long as the video lasts, and an idle socket is exactly what a paused
// video looks like — so anything that measures inactivity cuts playback rather than a stall.
const AGENT_OPTIONS = { keepAlive: true, keepAliveMsecs: 15000, maxSockets: MOST_SOCKETS };
const httpsAgent = new https.Agent(AGENT_OPTIONS);
const httpAgent = new http.Agent(AGENT_OPTIONS);
const agentFor = (url) => (String(url).indexOf('https:') === 0 ? httpsAgent : httpAgent);

// What can be given a deadline is the wait for the *headers*, because they arrive before the body
// does: a request that has answered nothing at all in this long is not coming back, and letting it
// go hands its socket back rather than holding one for the life of the service. A streaming body
// is never at risk from this — by the time it flows, the timer below has already been cleared.
const HEADERS_DEADLINE = 20000;

const RETRIABLE = ['ECONNRESET', 'EPIPE', 'ETIMEDOUT'];

const BODIED = ['POST', 'PUT', 'PATCH'];

// A request whose body was streamed from the client cannot be sent a second time — the stream has
// already been read. It is the one question both retries have to ask.
const isRepeatable = (req) => !!req && BODIED.indexOf(req.method) === -1;

const isRetriable = (error) => !!error
    && (RETRIABLE.indexOf(error.code) !== -1 || /socket hang up|premature close/i.test(error.message || ''));

// Guarded rather than assumed: an older runtime without AbortController still sends, it just keeps
// the old behaviour of waiting for ever.
const untilHeaders = (make) => {
    if (typeof AbortController !== 'function') return make(undefined);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEADERS_DEADLINE);
    const stop = (answer) => { clearTimeout(timer); return answer; };

    return make(controller.signal).then(stop, (error) => { stop(); throw error; });
};

const send = (url, req, headers) => {
    const body = isRepeatable(req) ? undefined : req;

    const options = {
        method: req.method,
        headers,
        body,
        redirect: 'manual',
        agent: agentFor(url)
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

// A body that dies part way through is the same failure as one that dies before the headers; the
// only difference is which side of them it happened on, and reading it is where the truncation
// shows up. Answering the page with a 500 for it is what put an empty account list on screen and
// sent a signed-in viewer to the setup wizard, so it is worth one more round trip.
const readText = (response, url, req, headers) => response.text().catch((error) => {
    if (!isRetriable(error) || !isRepeatable(req)) throw error;

    postmortem.note('upstream', `${postmortem.describe(error)} reading ${url.slice(0, 80)}`
        + ' — asking again');

    return send(url, req, headers).then((second) => second.text());
});

module.exports = { send, readText, isRepeatable };
