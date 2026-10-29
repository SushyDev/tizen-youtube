'use strict';

const fetch = require('node-fetch');
const http = require('http');
const https = require('https');

const postmortem = require('./postmortem.js');
const bigheaders = require('./bigheaders.js');
const lookup = require('./lookup.js');

// A booting page opens about thirty requests at once.
const MOST_SOCKETS = 64;

// No socket timeout: a paused SABR stream is an idle socket, and a timeout would cut playback.
const AGENT_OPTIONS = { keepAlive: true, keepAliveMsecs: 15000, maxSockets: MOST_SOCKETS };

// One pool per host name: requests go to an address (see addressed), node pools by address alone,
// and Google serves many names from one address. The agent is told the name itself: node 4 files
// a freed socket under a key holding the name it took from the Host header but looks for one
// without it, so a socket was never reused.
const agents = new Map();
const agentFor = (url) => {
    const parts = /^(https?:)\/\/([^/:?#]+)[^/?#]*/.exec(String(url));
    const key = parts ? parts[0] : String(url);

    if (!agents.has(key)) {
        const secure = !!parts && parts[1] === 'https:';
        const options = Object.assign({}, AGENT_OPTIONS, secure ? { servername: parts[2] } : {});
        agents.set(key, secure ? new https.Agent(options) : new http.Agent(options));
    }

    return agents.get(key);
};

// Only the wait for headers is bounded, so a streaming body is never cut.
const HEADERS_DEADLINE = 20000;

const RETRIABLE = ['ECONNRESET', 'EPIPE', 'ETIMEDOUT'];

// Failures that can mean the address we keep for a name has gone.
const UNREACHED = ['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT'];

const BODIED = ['POST', 'PUT', 'PATCH'];

const isRepeatable = (req) => !!req && BODIED.indexOf(req.method) === -1;

const isRetriable = (error) => !!error
    && (RETRIABLE.indexOf(error.code) !== -1 || /socket hang up|premature close/i.test(error.message || ''));

// Node 12 has no AbortController, and node-fetch accepts any signal whose constructor is named
// AbortSignal.
const SIGNAL = { constructor: { name: 'AbortSignal' } };

// Below node 8 node-fetch refuses any signal beside a streamed body, so those requests go unbounded.
const SIGNAL_BESIDE_STREAM = 'destroy' in require('stream').Readable.prototype;

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

const HOSTED = /^(https?:\/\/)([^/:?#]+)(.*)$/;

// Connects to the address lookup.js found. The agent takes the TLS name and the certificate check
// from the Host header, which headersFor always sets.
const addressed = (url, headers) => {
    const parts = HOSTED.exec(url);
    if (!parts || !headers.host) return Promise.resolve({ target: url, name: null });

    return lookup.resolve(parts[2]).then((address) => (address
        ? { target: `${parts[1]}${address}${parts[3]}`, name: parts[2], at: `${parts[1]}${address}`, was: `${parts[1]}${parts[2]}` }
        : { target: url, name: null }));
};

// node-fetch resolves a relative Location against the URL it asked, which named the address.
const renamed = (response, to) => {
    const location = to.name && response.headers.get('location');
    if (location && location.indexOf(to.at) === 0) response.headers.set('location', to.was + location.slice(to.at.length));

    return response;
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

    const attempt = (changed) => addressed(url, headers).then((to) => {
        const asked = (body && !SIGNAL_BESIDE_STREAM
            ? fetch(to.target, Object.assign({}, options, changed))
            : untilHeaders((signal) => fetch(to.target, Object.assign({}, options, changed, { signal }))));

        return asked.then((response) => renamed(response, to), (error) => {
            if (to.name && UNREACHED.indexOf(error.code) !== -1) lookup.forget(to.name);
            throw error;
        });
    });

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

const readText = (response, url, req, headers) => textOf(response).catch((error) => {
    if (!isRetriable(error) || !isRepeatable(req)) throw error;

    postmortem.note('upstream', `${postmortem.describe(error)} reading ${url.slice(0, 80)}`
        + ' — asking again');

    return send(url, req, headers, true).then(textOf);
});

module.exports = { send, readText };
