'use strict';

const postmortem = require('./postmortem.js');
const lookup = require('./lookup.js');

// By hand: node 4.4.3 has no URL.
const splitUrl = (text) => {
    const parts = /^(https?:)\/\/([^/:]+)(?::(\d+))?(\/.*)?$/.exec(text) || [];

    return { protocol: parts[1] || 'https:', hostname: parts[2] || 'www.youtube.com', port: parts[3], path: parts[4] || '/' };
};

const TARGET = splitUrl(process.env.TUBE_REACH_URL || 'https://www.youtube.com/generate_204');
const EVERY = 10000;
const TIMEOUT = 8000;

const held = { at: 0, busy: false, ok: null, why: 'not checked yet' };

const settle = (ok, why) => {
    if (!held.busy) return;

    held.busy = false;
    held.at = Date.now();

    if (ok !== held.ok) {
        postmortem.note('network', ok
            ? `${TARGET.hostname} is reachable from the TV`
            : `${TARGET.hostname} is not reachable from the TV: ${why}`);
    }

    held.ok = ok;
    held.why = why;
};

// The system resolver alone can spend 10 s of the boot screen here; see lookup.js.
const ask = () => lookup.resolve(TARGET.hostname).then((address) => {
    const client = TARGET.protocol === 'http:' ? require('http') : require('https');
    const request = client.request({
        protocol: TARGET.protocol,
        hostname: address || TARGET.hostname,
        servername: TARGET.hostname,
        headers: { host: TARGET.port ? `${TARGET.hostname}:${TARGET.port}` : TARGET.hostname },
        port: TARGET.port,
        path: TARGET.path,
        method: 'HEAD'
    }, (response) => {
        response.resume();
        settle(true, `answered ${response.statusCode}`);
    });

    request.setTimeout(TIMEOUT, () => {
        settle(false, 'timed out');
        request.abort();
    });
    request.on('error', (error) => settle(false, error.code || error.message));
    request.end();
}).catch((error) => settle(false, error.message));

// At most every ten seconds, however often it is asked.
const check = () => {
    if (held.busy || Date.now() - held.at < EVERY) return;
    held.busy = true;

    try {
        ask();
    } catch (error) {
        settle(false, error.message);
    }
};

const current = () => ({ ok: held.ok, why: held.why, host: TARGET.hostname });

module.exports = { check, current };
