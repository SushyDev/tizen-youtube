'use strict';

// Making the request upstream, and making it again when the connection was the problem.
//
// Two failures are worth a second attempt and neither is the server's fault. A pooled socket that
// died while idle is handed out anyway and the request dies on it — newer Node retries that itself,
// but the Node inside a Tizen service is old enough that nothing does. And YouTube's header block
// is larger than Node's HTTP/1 parser will accept, with no way to raise the limit from in here, so
// that request goes again over HTTP/2. Neither retry is possible once a body has been streamed.

const fetch = require('node-fetch');
const http = require('http');
const https = require('https');

const postmortem = require('./postmortem.js');
const bigheaders = require('./bigheaders.js');

const AGENT_OPTIONS = { keepAlive: true, keepAliveMsecs: 15000 };
const httpsAgent = new https.Agent(AGENT_OPTIONS);
const httpAgent = new http.Agent(AGENT_OPTIONS);
const agentFor = (url) => (String(url).indexOf('https:') === 0 ? httpsAgent : httpAgent);

const RETRIABLE = ['ECONNRESET', 'EPIPE', 'ETIMEDOUT'];

const BODIED = ['POST', 'PUT', 'PATCH'];

const isRetriable = (error) => !!error
    && (RETRIABLE.indexOf(error.code) !== -1 || /socket hang up|premature close/i.test(error.message || ''));

const send = (url, req, headers) => {
    const body = BODIED.indexOf(req.method) === -1 ? undefined : req;

    const options = {
        method: req.method,
        headers,
        body,
        redirect: 'manual',
        agent: agentFor(url)
    };

    return fetch(url, options).catch((error) => {
        if (bigheaders.isHeaderOverflow(error) && !body && url.indexOf('https:') === 0) {
            postmortem.note('upstream', `header overflow on ${url.slice(0, 80)} — retrying over http2`);
            return bigheaders.fetchOverHttp2(url, { method: req.method, headers });
        }

        // A streamed body cannot be sent twice.
        if (!isRetriable(error) || body) throw error;

        postmortem.note('upstream', `${postmortem.describe(error)} on ${url.slice(0, 80)}`
            + ' — retrying on a fresh connection');

        return fetch(url, Object.assign({}, options, { agent: undefined }));
    });
};
module.exports = { send, isRetriable };
