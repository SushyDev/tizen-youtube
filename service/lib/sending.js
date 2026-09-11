'use strict';

// Sends upstream, retrying once on a dead pooled socket or a header overflow.

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

module.exports = { send };
